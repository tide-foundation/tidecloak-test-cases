#!/usr/bin/env bash

# Handover Admin Functions
# Source this file to use the functions

TIDECLOAK_LOCAL_URL="${TIDECLOAK_LOCAL_URL:-http://localhost:8080}"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"
REALM_NAME="${REALM_NAME:-}"

CURL_OPTS=""
if [[ "$TIDECLOAK_LOCAL_URL" == https://* ]]; then
    CURL_OPTS="-k"
fi

# Function 1: Get admin token
get_admin_token() {
    curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/realms/master/protocol/openid-connect/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=${KC_USER}" \
        -d "password=${KC_PASSWORD}" \
        -d "grant_type=password" \
        -d "client_id=admin-cli" | jq -r '.access_token'
}

# Function 2: Get Tide invite link for a user
# Usage: get_tide_invite_link <username>
# Requires REALM_NAME environment variable
get_tide_invite_link() {
    local username="$1"

    if [[ -z "$REALM_NAME" || -z "$username" ]]; then
        echo "Usage: get_tide_invite_link <username>" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"

    local token
    token="$(get_admin_token)"

    # Get user ID
    local user_id
    user_id=$(curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users?username=${username}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id')

    if [[ -z "$user_id" || "$user_id" == "null" ]]; then
        echo "User '${username}' not found in realm '${realm_name}'" >&2
        return 1
    fi

    # Generate invite link
    local invite_link
    invite_link=$(curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/tideAdminResources/get-required-action-link?userId=${user_id}&lifespan=43200" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d '["link-tide-account-action"]')

    echo "$invite_link"
}

# Function 3: Create a user in the realm
# Usage: create_user <username> <email>
# Requires REALM_NAME environment variable
create_user() {
    local username="$1"
    local email="${2:-${username}@tidecloak.com}"

    if [[ -z "$REALM_NAME" || -z "$username" ]]; then
        echo "Usage: create_user <username> [email]" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"
    local token
    token="$(get_admin_token)"

    # Check if user already exists
    local existing
    existing=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users?username=${username}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id // empty')

    if [[ -n "$existing" ]]; then
        echo "User '${username}' already exists (id: ${existing})"
        return 0
    fi

    # Create user
    curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"${username}\",\"email\":\"${email}\",\"firstName\":\"${username}\",\"lastName\":\"user\",\"enabled\":true,\"emailVerified\":false,\"requiredActions\":[],\"attributes\":{\"locale\":\"\"},\"groups\":[]}" > /dev/null 2>&1

    echo "User '${username}' created"
}

# Function 4: Assign tide-realm-admin role to a user
# Usage: assign_realm_admin_role <username>
# Requires REALM_NAME environment variable
assign_realm_admin_role() {
    local username="$1"

    if [[ -z "$REALM_NAME" || -z "$username" ]]; then
        echo "Usage: assign_realm_admin_role <username>" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"
    local client_id="realm-management"
    local client_role_name="tide-realm-admin"

    local token
    token="$(get_admin_token)"

    # Get user ID
    local user_id
    user_id=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users?username=${username}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id')

    if [[ -z "$user_id" || "$user_id" == "null" ]]; then
        echo "User '${username}' not found in realm '${realm_name}'" >&2
        return 1
    fi

    # Get the internal client UUID for realm-management
    local client_uuid
    client_uuid=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/clients?clientId=${client_id}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id')

    # Get the client role representation
    local client_role_json
    client_role_json=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/clients/${client_uuid}/roles/${client_role_name}" \
        -H "Authorization: Bearer $token")

    # Assign that client role to the user
    curl -s $CURL_OPTS -X POST \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users/${user_id}/role-mappings/clients/${client_uuid}" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "[$client_role_json]" > /dev/null 2>&1

    echo "User '${username}' now has tide-realm-admin role"
}

# Function 4b: Assign a client role to a user
# Usage: assign_client_role <username> <client_id> <role_name>
# Requires REALM_NAME environment variable
assign_client_role() {
    local username="$1"
    local client_id="$2"
    local role_name="$3"

    if [[ -z "$REALM_NAME" || -z "$username" || -z "$client_id" || -z "$role_name" ]]; then
        echo "Usage: assign_client_role <username> <client_id> <role_name>" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"
    local token
    token="$(get_admin_token)"

    # Get user ID
    local user_id
    user_id=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users?username=${username}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id')

    if [[ -z "$user_id" || "$user_id" == "null" ]]; then
        echo "User '${username}' not found in realm '${realm_name}'" >&2
        return 1
    fi

    # Get the internal client UUID for the specified client
    local client_uuid
    client_uuid=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/clients?clientId=${client_id}" \
        -H "Authorization: Bearer $token" | jq -r '.[0].id')

    if [[ -z "$client_uuid" || "$client_uuid" == "null" ]]; then
        echo "Client '${client_id}' not found in realm '${realm_name}'" >&2
        return 1
    fi

    # Get the client role representation
    local client_role_json
    client_role_json=$(curl -s $CURL_OPTS -X GET \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/clients/${client_uuid}/roles/${role_name}" \
        -H "Authorization: Bearer $token")

    if [[ -z "$client_role_json" || "$client_role_json" == "null" || "$client_role_json" == *"error"* ]]; then
        echo "Role '${role_name}' not found for client '${client_id}'" >&2
        return 1
    fi

    # Assign that client role to the user
    curl -s $CURL_OPTS -X POST \
        "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users/${user_id}/role-mappings/clients/${client_uuid}" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "[$client_role_json]" > /dev/null 2>&1

    echo "User '${username}' now has '${role_name}' role from client '${client_id}'"
}

# Function 5: Approve and commit change-sets
# Usage: approve_and_commit <type>  (type: clients, users, roles, etc.)
# Requires REALM_NAME environment variable
approve_and_commit() {
    local type="$1"

    if [[ -z "$REALM_NAME" || -z "$type" ]]; then
        echo "Usage: approve_and_commit <type>" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"
    local token
    token="$(get_admin_token)"

    # Get change-sets
    local requests
    requests=$(curl -s -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/tide-admin/change-set/${type}/requests" \
        -H "Authorization: Bearer $token" 2>/dev/null || echo "[]")

    local count
    count=$(echo "$requests" | jq 'length' 2>/dev/null || echo "0")

    if [ "$count" = "0" ] || [ "$count" = "" ]; then
        echo "No ${type} change-sets to process"
        return 0
    fi

    echo "$requests" | jq -c '.[]' | while read -r req; do
        local payload
        payload=$(jq -n --arg id "$(echo "$req" | jq -r .draftRecordId)" \
                        --arg cst "$(echo "$req" | jq -r .changeSetType)" \
                        --arg at "$(echo "$req" | jq -r .actionType)" \
                        '{changeSetId:$id,changeSetType:$cst,actionType:$at}')

        # Sign the change-set
        curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/tide-admin/change-set/sign" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -d "$payload" > /dev/null 2>&1

        # Commit the change-set
        curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/tide-admin/change-set/commit" \
            -H "Authorization: Bearer $token" \
            -H "Content-Type: application/json" \
            -d "$payload" > /dev/null 2>&1
    done

    echo "${type^} change-sets processed"
}

# Function 6: Setup user (create + invite link, optionally assign role)
# Usage: setup_user <username> [with-role]
# Requires REALM_NAME environment variable
setup_user() {
    local username="$1"
    local with_role="${2:-}"

    if [[ -z "$REALM_NAME" || -z "$username" ]]; then
        echo "Usage: setup_user <username> [with-role]" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    # Step 1: Create user
    create_user "$username"

    # Step 2: Approve user creation
    approve_and_commit users

    # Step 3: Get invite link
    local invite_link
    invite_link=$(get_tide_invite_link "$username")
    echo "Invite link: $invite_link"

    # Step 4: Optionally assign role
    if [[ "$with_role" == "with-role" ]]; then
        assign_realm_admin_role "$username"
        approve_and_commit users
        echo "User '${username}' setup complete (with tide-realm-admin role)"
    else
        echo "User '${username}' setup complete (no admin role)"
    fi
}

# Function 7: Confirm Tide user is linked
# Usage: confirm_tide_user_linked <username>
# Requires REALM_NAME environment variable
# Returns: 0 if linked, 1 if not linked
confirm_tide_user_linked() {
    local username="$1"

    if [[ -z "$REALM_NAME" || -z "$username" ]]; then
        echo "Usage: confirm_tide_user_linked <username>" >&2
        echo "       Requires REALM_NAME environment variable" >&2
        return 1
    fi

    local realm_name="$REALM_NAME"

    local token
    token="$(get_admin_token)"

    local attrs
    attrs=$(curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${realm_name}/users?username=${username}" \
        -H "Authorization: Bearer $token")

    local tide_user_key
    local vuid
    tide_user_key=$(echo "$attrs" | jq -r '.[0].attributes.tideUserKey[0] // empty')
    vuid=$(echo "$attrs" | jq -r '.[0].attributes.vuid[0] // empty')

    if [[ -n "$tide_user_key" && -n "$vuid" ]]; then
        echo "User '${username}' is linked (tideUserKey: ${tide_user_key:0:20}..., vuid: ${vuid:0:20}...)"
        return 0
    else
        echo "User '${username}' is NOT linked to a Tide account"
        return 1
    fi
}

# Command dispatcher - only runs if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    case "${1:-}" in
        -t|--token)
            get_admin_token
            ;;
        -i|--invite)
            get_tide_invite_link "$2"
            ;;
        -c|--confirm)
            confirm_tide_user_linked "$2"
            ;;
        -r|--role)
            assign_realm_admin_role "$2"
            ;;
        -a|--approve)
            approve_and_commit "$2"
            ;;
        -u|--user)
            create_user "$2" "$3"
            ;;
        -s|--setup)
            setup_user "$2" "$3"
            ;;
        --client-role)
            assign_client_role "$2" "$3" "$4"
            ;;
        -h|--help|*)
            echo "Usage: $0 [option] [args...]"
            echo ""
            echo "Options:"
            echo "  -t, --token              Get admin access token"
            echo "  -u, --user <username> [email]  Create a user"
            echo "  -s, --setup <username> [with-role]  Setup user (create + invite, optionally add role)"
            echo "  -i, --invite <username>  Get Tide invite link"
            echo "  -r, --role <username>    Assign tide-realm-admin role to user"
            echo "  --client-role <username> <client_id> <role_name>  Assign client role to user"
            echo "  -a, --approve <type>     Approve and commit change-sets (users, clients, etc.)"
            echo "  -c, --confirm <username> Check if user is linked"
            echo "  -h, --help               Show this help"
            echo ""
            echo "Environment variables (required):"
            echo "  REALM_NAME    Realm name"
            echo ""
            echo "Environment variables (optional):"
            echo "  KC_USER       Admin username (default: admin)"
            echo "  KC_PASSWORD   Admin password (default: password)"
            [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]] && exit 0 || exit 1
            ;;
    esac
fi
