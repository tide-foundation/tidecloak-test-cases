import { getAuthServerUrl, getRealm, getResource, getVendorId, initTcData } from "./tidecloakConfig";
import { Policy } from "asgard-tide";
import { base64ToBytes } from "./tideSerialization";

const getTcUrl = () => `${getAuthServerUrl()}/admin/realms/${getRealm()}`;
const getNonAdminTcUrl = () => `${getAuthServerUrl()}/realms/${getRealm()}`;

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

export interface ChangeSetRequest {
    changeSetId: string;
    changeSetType: string;
    actionType: string;
}

// Get admin policy from TideCloak (used for policy validation)
export const getAdminPolicy = async (): Promise<Policy> => {
    // Ensure config is loaded (important for server-side calls)
    await initTcData();
    const url = `${getNonAdminTcUrl()}/tide-policy-resources/admin-policy`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Error fetching admin policy: ${await response.text()}`);
    }
    const policy = Policy.from(base64ToBytes(await response.text()));
    return policy;
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

// Get user change requests (drafts)
export const getUserChangeRequests = async (token: string): Promise<{ data: any, retrievalInfo: ChangeSetRequest }[]> => {
    const response = await fetch(`${getTcUrl()}/tide-admin/change-set/users/requests`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error getting user change requests: ${await response.text()}`);
    }
    const json = await response.json();
    return json.map((d: any) => ({
        data: d,
        retrievalInfo: {
            changeSetId: d.draftRecordId,
            changeSetType: d.changeSetType,
            actionType: d.actionType
        }
    }));
};

// Get client (policy) change requests
export const getClientChangeRequests = async (token: string): Promise<{ data: any, retrievalInfo: ChangeSetRequest }[]> => {
    const response = await fetch(`${getTcUrl()}/tide-admin/change-set/clients/requests`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
        throw new Error(`Error getting client change requests: ${await response.text()}`);
    }
    const json = await response.json();
    return json.map((d: any) => ({
        data: d,
        retrievalInfo: {
            changeSetId: d.draftRecordId,
            changeSetType: d.changeSetType,
            actionType: d.actionType
        }
    }));
};

// Get raw change set request for signing
export const getRawChangeSetRequest = async (changeSet: ChangeSetRequest, token: string): Promise<Uint8Array> => {
    const response = await fetch(`${getTcUrl()}/tide-admin/change-set/sign/batch`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changeSets: [changeSet] })
    });
    if (!response.ok) {
        throw new Error(`Error getting raw change set: ${await response.text()}`);
    }
    const r = (await response.json())[0];
    // Decode base64 to Uint8Array
    const binaryString = atob(r.changeSetDraftRequests);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

// Add approval to change set
export const addApproval = async (changeSet: ChangeSetRequest, approvedRequest: Uint8Array, token: string): Promise<void> => {
    const formData = new FormData();
    formData.append("changeSetId", changeSet.changeSetId);
    formData.append("actionType", changeSet.actionType);
    formData.append("changeSetType", changeSet.changeSetType);
    // Encode Uint8Array to base64
    const base64 = btoa(String.fromCharCode(...approvedRequest));
    formData.append("requests", base64);

    const response = await fetch(`${getTcUrl()}/tideAdminResources/add-review`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData
    });
    if (!response.ok) {
        throw new Error(`Error adding approval: ${await response.text()}`);
    }
};

// Commit change request
export const commitChangeRequest = async (changeSet: ChangeSetRequest, token: string): Promise<void> => {
    const response = await fetch(`${getTcUrl()}/tide-admin/change-set/commit`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(changeSet)
    });
    if (!response.ok) {
        throw new Error(`Error committing change set: ${await response.text()}`);
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
