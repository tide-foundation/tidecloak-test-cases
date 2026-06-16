import { getAuthServerUrl, getRealm, getResource, getVendorId, initTcData } from "./tidecloakConfig";
import { Models } from "@tide/js";
const Policy = Models.Policy;
type Policy = InstanceType<typeof Policy>;
import { base64ToBytes } from "./tideSerialization";

const getTcUrl = () => `${getAuthServerUrl()}/admin/realms/${getRealm()}`;

export interface ClientRepresentation {
    id?: string;
    clientId?: string;
    description?: string;
}

// Get the realm's admin (M0) policy from TideCloak (used for policy validation).
// This is the role policy bound to the tide-realm-admin client role. Replaces the
// removed unauthenticated /tide-policy-resources/admin-policy endpoint: it now needs
// a manage-realm admin token and a tide-realm-admin role-id lookup first.
export const getAdminPolicy = async (token: string): Promise<Policy> => {
    // Ensure config is loaded (important for server-side calls)
    await initTcData();

    // tide-realm-admin is a client role on the realm-management client.
    const rmClient = await getClientByClientId("realm-management", token);
    if (!rmClient) throw new Error("realm-management client not found");

    const roleResponse = await fetch(`${getTcUrl()}/clients/${rmClient.id}/roles/tide-realm-admin`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!roleResponse.ok) {
        throw new Error(`Error resolving tide-realm-admin role: ${await roleResponse.text()}`);
    }
    const adminRoleId = (await roleResponse.json()).id;

    // The role policy bound to that role is the admin (M0) policy.
    const response = await fetch(`${getTcUrl()}/iga/role-policies/role/${adminRoleId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error fetching admin policy: ${await response.text()}`);
    }
    const { policy } = await response.json();
    return Policy.from(base64ToBytes(policy));
};

// Get vendor ID for policy creation
export const getVendorIdForPolicy = (): string => {
    return getVendorId();
};

// Get resource (client ID) for policy creation
export const getResourceForPolicy = (): string => {
    return getResource();
};

// Get client by clientId (used to resolve the realm-management client for getAdminPolicy)
export const getClientByClientId = async (clientId: string, token: string): Promise<ClientRepresentation | null> => {
    const response = await fetch(`${getTcUrl()}/clients?clientId=${clientId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const clients: ClientRepresentation[] = await response.json();
    return clients.length > 0 ? clients[0] : null;
};
