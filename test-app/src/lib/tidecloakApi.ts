import { getAuthServerUrl, getRealm, getResource, getVendorId, initTcData } from "./tidecloakConfig";
import { Models } from "@tide/js";
const Policy = Models.Policy;
type Policy = InstanceType<typeof Policy>;
import { base64ToBytes } from "./tideSerialization";

const getTcUrl = () => `${getAuthServerUrl()}/admin/realms/${getRealm()}`;

export interface RoleRepresentation {
    id?: string;
    name?: string;
    description?: string;
    clientRole?: boolean;
    containerId?: string;
}

export interface ClientRepresentation {
    id?: string;
    clientId?: string;
    description?: string;
}

// A change request (CR) as returned by the IGA change-request API
// (GET /iga/change-requests). The new API is NOT typed by entity kind — a single
// endpoint returns every pending CR and callers filter on `entityType`.
export interface ChangeRequest {
    id: string;
    realmId?: string;
    entityType: string;   // USER / ROLE / GROUP / CLIENT / CLIENT_SCOPE / ... / BATCH
    entityId?: string;
    actionType: string;   // GRANT_ROLES / CREATE_CLIENT / ADD_COMPOSITE / ...
    status: string;       // PENDING / APPROVED / DENIED / CANCELLED
    requestedBy?: string;
    createdAt?: number;
    threshold?: number;
    authorizationCount?: number;
    readyToCommit?: boolean;
    requiredApproverRoles?: string[];
    scopeMode?: string;
    dependsOn?: string[];
    blocked?: boolean;
    blockedReason?: string;
    [key: string]: any;
}

// The Phase-1 payload the admin's Tide enclave must approve (two-phase multiAdmin
// model). `requestModel` is a base64-serialized Policy:1 ModelRequest.
export interface ApprovalModel {
    changeRequestId: string;
    actionType: string;
    requiresApprovalPopup: boolean;
    requestModel: string;
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

// Get client by clientId
export const getClientByClientId = async (clientId: string, token: string): Promise<ClientRepresentation | null> => {
    const response = await fetch(`${getTcUrl()}/clients?clientId=${clientId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const clients: ClientRepresentation[] = await response.json();
    return clients.length > 0 ? clients[0] : null;
};

// Create client for transaction management
export const createClient = async (token: string): Promise<void> => {
    const clientRep: ClientRepresentation = {
        clientId: getResource(),
        description: "Test app client"
    };
    const response = await fetch(`${getTcUrl()}/clients`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(clientRep)
    });
    if (!response.ok) {
        throw new Error(`Error creating client: ${await response.text()}`);
    }
};

// Get roles for client
export const getClientRoles = async (token: string): Promise<RoleRepresentation[]> => {
    const client = await getClientByClientId(getResource(), token);
    if (!client) return [];

    const response = await fetch(`${getTcUrl()}/clients/${client.id}/roles`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return await response.json();
};

// Create role for client
export const createRoleForClient = async (roleName: string, description: string, token: string): Promise<void> => {
    let client = await getClientByClientId(getResource(), token);
    if (!client) {
        await createClient(token);
        client = await getClientByClientId(getResource(), token);
    }

    const roleRep: RoleRepresentation = { name: roleName, description };
    const response = await fetch(`${getTcUrl()}/clients/${client!.id}/roles`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(roleRep)
    });
    if (!response.ok) {
        throw new Error(`Error creating role: ${await response.text()}`);
    }
};

// List change requests (PENDING by default). The IGA change-request API is not
// typed by entity kind — this single endpoint returns every CR for the realm, and
// callers bucket them by `entityType` (e.g. USER vs everything else).
export const getPendingChangeRequests = async (token: string, status = "PENDING"): Promise<ChangeRequest[]> => {
    const response = await fetch(`${getTcUrl()}/iga/change-requests?status=${status}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error getting change requests: ${await response.text()}`);
    }
    return await response.json();
};

// Phase 1 of the two-phase multiAdmin approval: fetch the Policy:1 ModelRequest
// that the admin's Tide enclave must sign. Returns 409 (NOT_MULTI_ADMIN) on
// firstAdmin / Tideless / simple realms, where the single-phase authorize is used.
export const getApprovalModel = async (crId: string, token: string): Promise<ApprovalModel> => {
    const response = await fetch(`${getTcUrl()}/iga/change-requests/${crId}/approval-model`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error getting approval model: ${await response.text()}`);
    }
    return await response.json();
};

// Phase 2 of the two-phase multiAdmin approval: hand the doken-embedded model back
// to TideCloak. Records ONE approval toward threshold; does not commit.
export const submitApprovalModel = async (crId: string, approvedModel: Uint8Array, token: string): Promise<void> => {
    const base64 = btoa(String.fromCharCode(...approvedModel));
    const response = await fetch(`${getTcUrl()}/iga/change-requests/${crId}/approval-model`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ requestModel: base64 }),
    });
    if (!response.ok) {
        throw new Error(`Error submitting approval: ${await response.text()}`);
    }
};

// Single-phase approval (firstAdmin / non-multiAdmin realms): records this admin's
// username-only approval toward threshold. 409 if already signed or not PENDING.
export const authorizeChangeRequest = async (crId: string, token: string): Promise<void> => {
    const response = await fetch(`${getTcUrl()}/iga/change-requests/${crId}/authorize`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
    });
    if (!response.ok) {
        throw new Error(`Error authorizing change request: ${await response.text()}`);
    }
};

// Commit a CR: re-checks the approver/dependency/threshold gates, then replays and
// applies the change. May return 412 (under threshold / dependency not yet met).
export const commitChangeRequest = async (crId: string, token: string): Promise<void> => {
    const response = await fetch(`${getTcUrl()}/iga/change-requests/${crId}/commit`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
    });
    if (!response.ok) {
        throw new Error(`Error committing change request: ${await response.text()}`);
    }
};

// Get all users
export const getUsers = async (token: string): Promise<any[]> => {
    const response = await fetch(`${getTcUrl()}/users?briefRepresentation=false`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return await response.json();
};

// Grant role to user
export const grantUserRole = async (userId: string, roleName: string, token: string): Promise<void> => {
    const client = await getClientByClientId(getResource(), token);
    if (!client) throw new Error("Client not found");

    // Get the role
    const roleResponse = await fetch(`${getTcUrl()}/clients/${client.id}/roles/${roleName}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!roleResponse.ok) throw new Error("Role not found");
    const role = await roleResponse.json();

    // Assign role to user
    const response = await fetch(`${getTcUrl()}/users/${userId}/role-mappings/clients/${client.id}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([role])
    });
    if (!response.ok) {
        throw new Error(`Error granting role: ${await response.text()}`);
    }
};

// Get realm roles
export const getRealmRoles = async (token: string): Promise<RoleRepresentation[]> => {
    const response = await fetch(`${getTcUrl()}/roles`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return await response.json();
};

// Create realm role
export const createRealmRole = async (roleName: string, description: string, token: string): Promise<void> => {
    const roleRep: RoleRepresentation = { name: roleName, description };
    const response = await fetch(`${getTcUrl()}/roles`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(roleRep)
    });
    if (!response.ok) {
        throw new Error(`Error creating realm role: ${await response.text()}`);
    }
};

// Grant realm role to user
export const grantUserRealmRole = async (userId: string, roleName: string, token: string): Promise<void> => {
    // Get the realm role
    const roleResponse = await fetch(`${getTcUrl()}/roles/${roleName}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!roleResponse.ok) throw new Error("Realm role not found");
    const role = await roleResponse.json();

    // Assign realm role to user
    const response = await fetch(`${getTcUrl()}/users/${userId}/role-mappings/realm`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([role])
    });
    if (!response.ok) {
        throw new Error(`Error granting realm role: ${await response.text()}`);
    }
};
