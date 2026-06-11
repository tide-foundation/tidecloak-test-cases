#!/usr/bin/env bash

# Tidecloak Realm Initialization Script
# This script sets up a new Tidecloak realm with Tide configuration

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

echo "================================================"
echo "  Tidecloak Realm Initialization"
echo "================================================"
echo ""

# Load environment
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [ -f "$ENV_FILE" ]; then
    log_info "Loading environment from: $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
else
    log_warn ".env file not found at: $ENV_FILE - using defaults"
fi

# Configuration
TIDECLOAK_PORT="${TIDECLOAK_PORT:-8080}"
TIDECLOAK_LOCAL_URL="${TIDECLOAK_LOCAL_URL:-http://localhost:${TIDECLOAK_PORT}}"
TIDECLOAK_EXTERNAL_URL="${TIDECLOAK_LOCAL_URL}"
CLIENT_APP_URL="${CLIENT_APP_URL:-http://localhost:3000}"

REALM_JSON_PATH="${REALM_JSON_PATH:-$SCRIPT_DIR/realm.json}"
# Output tidecloak.json to test-app/data by default
REPO_ROOT="$(dirname "$ROOT_DIR")"
ADAPTER_OUTPUT_PATH="${ADAPTER_OUTPUT_PATH:-$REPO_ROOT/test-app/data/tidecloak.json}"
NEW_REALM_NAME="${NEW_REALM_NAME:-$(uuidgen)}"
REALM_MGMT_CLIENT_ID="realm-management"
ADMIN_ROLE_NAME="tide-realm-admin"
KC_USER="${KC_USER:-admin}"
KC_PASSWORD="${KC_PASSWORD:-password}"
CLIENT_NAME="${CLIENT_NAME:-myclient}"
DPOP_CLIENT_NAME="${DPOP_CLIENT_NAME:-mydpopclient}"
DPOP_ADAPTER_OUTPUT_PATH="${DPOP_ADAPTER_OUTPUT_PATH:-$REPO_ROOT/test-app/data/tidecloak-dpop.json}"

CURL_OPTS="-f"
if [[ "$TIDECLOAK_LOCAL_URL" == https://* ]]; then
    CURL_OPTS="-f -k"
fi

log_info "Configuration:"
log_info "  Tidecloak Local URL: $TIDECLOAK_LOCAL_URL"
log_info "  Tidecloak External URL: $TIDECLOAK_EXTERNAL_URL"
log_info "  Client App URL: $CLIENT_APP_URL"
echo ""

# Check if realm.json exists
if [ ! -f "$REALM_JSON_PATH" ]; then
    log_error "Realm template not found at: $REALM_JSON_PATH"
    exit 1
fi

# Wait for Tidecloak
log_info "Checking Tidecloak connectivity..."
for i in {1..15}; do
    if curl -s -f $CURL_OPTS --connect-timeout 5 "$TIDECLOAK_LOCAL_URL" > /dev/null 2>&1; then
        log_info "✓ Tidecloak is accessible"
        break
    fi
    if [ $i -eq 15 ]; then
        log_error "Cannot connect to Tidecloak at $TIDECLOAK_LOCAL_URL"
        exit 1
    fi
    log_warn "Waiting for Tidecloak (attempt $i/15)..."
    sleep 5
done
echo ""

# Function to get admin token
get_admin_token() {
    curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/realms/master/protocol/openid-connect/token" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=${KC_USER}" \
        -d "password=${KC_PASSWORD}" \
        -d "grant_type=password" \
        -d "client_id=admin-cli" | jq -r '.access_token'
}

REALM_NAME="${NEW_REALM_NAME}"
echo "📄 Generated realm name: $REALM_NAME"

TMP_REALM_JSON="$(mktemp)"
cp "$REALM_JSON_PATH" "$TMP_REALM_JSON"
sed -i "s|http://localhost:3000|$CLIENT_APP_URL|g" "$TMP_REALM_JSON"
sed -i "s|nextjs-test|$REALM_NAME|g" "$TMP_REALM_JSON"
sed -i "s|mydpopclient|$DPOP_CLIENT_NAME|g" "$TMP_REALM_JSON"
sed -i "s|myclient|$CLIENT_NAME|g" "$TMP_REALM_JSON"

# Create realm
echo "🌍 Creating realm..."
TOKEN="$(get_admin_token)"
status=$(curl -s $CURL_OPTS -o /dev/null -w "%{http_code}" \
    -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data-binary @"$TMP_REALM_JSON")

if [[ $status == 2* ]]; then
    echo "✅ Realm created."
else
    echo "❌ Realm creation failed (HTTP $status)"
    exit 1
fi

# Initialize Tide realm + IGA
TOKEN="$(get_admin_token)"
echo "🔐 Initializing Tide realm + IGA..."
curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/setUpTideRealm" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "email=email@tide.org" \
    --data-urlencode "isRagnarokEnabled=true" > /dev/null 2>&1

curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-admin/toggle-iga" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "isIGAEnabled=true" > /dev/null 2>&1
echo "✅ Tide realm + IGA done."

# Update CustomAdminUIDomain
TOKEN="$(get_admin_token)"
echo "🌐 Updating CustomAdminUIDomain..."
INST=$(curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/identity-provider/instances/tide" \
    -H "Authorization: Bearer $TOKEN")
UPDATED=$(echo "$INST" | jq --arg d "$CLIENT_APP_URL" '.config.CustomAdminUIDomain=$d')

curl -s $CURL_OPTS -X PUT "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/identity-provider/instances/tide" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$UPDATED" > /dev/null 2>&1

curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/sign-idp-settings" \
    -H "Authorization: Bearer $TOKEN" > /dev/null 2>&1
echo "✅ CustomAdminUIDomain updated + signed."

# Drain all PENDING IGA change requests via the bulk-authorize operator endpoint
# (change-request-guide.md §3.4) — the purpose-built one-shot for the toggle-on ADOPT
# closure. It authorizes AND commits every candidate using the same per-CR gate as the
# single-CR endpoints, and sorts REGEN_ADMIN_POLICY last so it cannot strand still-
# pending grants:
#   GET  /iga/change-requests?status=PENDING          -> [ {id, actionType, ...}, ... ]
#   POST /iga/change-requests/bulk-authorize {crIdIn}  -> { results[], summary{} }
# firstAdmin mode (threshold=1, VRK-approved): toggle-iga-on auto-commits the baseline
# defaults; anything still PENDING (e.g. provisioned clients) is drained here. Idempotent:
# loops while forward progress is made so dependency chains clear over successive passes.
# The optional $1 label is cosmetic (the API is not typed by entity kind).
approve_and_commit() {
    local LABEL="${1:-pending}"
    echo "🔄 Processing ${LABEL} change requests..."

    local base="${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/iga/change-requests"
    local max_passes=10
    local pass=0
    while [ "$pass" -lt "$max_passes" ]; do
        pass=$((pass + 1))
        TOKEN="$(get_admin_token)"

        # Collect all PENDING CR ids (don't use -f: an empty array is valid/OK).
        local ids_json count
        ids_json=$(curl -s -X GET "${base}?status=PENDING" \
            -H "Authorization: Bearer $TOKEN" 2>/dev/null | jq -c '[.[].id]' 2>/dev/null || echo "[]")
        count=$(echo "$ids_json" | jq 'length' 2>/dev/null || echo "0")

        if [ "$count" = "0" ] || [ "$count" = "" ]; then
            if [ "$pass" -eq 1 ]; then
                echo "  No ${LABEL} change requests to process"
            fi
            break
        fi

        echo "  Pass ${pass}: draining ${count} PENDING change request(s) via bulk-authorize"

        # One-shot authorize + commit of the whole pending set.
        local resp http_status body
        resp=$(curl -s -w "\n%{http_code}" -X POST "${base}/bulk-authorize" \
            -H "Authorization: Bearer $TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"crIdIn\":${ids_json},\"limit\":1000}" 2>/dev/null)
        http_status=$(echo "$resp" | tail -1)
        body=$(echo "$resp" | sed '$d')

        # Another bulk-authorize is already running for this realm — wait and retry.
        if [ "$http_status" = "429" ]; then
            echo "  bulk-authorize busy (429); waiting and retrying..."
            sleep 2
            continue
        fi
        if [[ ! "$http_status" =~ ^2 ]]; then
            log_error "bulk-authorize failed (HTTP $http_status): $body"
            return 1
        fi

        local committed rejected skipped
        committed=$(echo "$body" | jq -r '.summary.committed // 0' 2>/dev/null || echo "0")
        rejected=$(echo "$body" | jq -r '.summary.rejected // 0' 2>/dev/null || echo "0")
        skipped=$(echo "$body" | jq -r '.summary.skipped // 0' 2>/dev/null || echo "0")
        echo "  committed=${committed} rejected=${rejected} skipped=${skipped}"

        # No forward progress this pass — remaining CRs are blocked/deferred; stop.
        if [ "$committed" = "0" ]; then
            if [ "$rejected" != "0" ]; then
                log_warn "  ${rejected} change request(s) could not be committed (blocked/deferred):"
                echo "$body" | jq -r '.results[] | select(.status=="REJECTED") | "    REJECTED \(.actionType) \(.crId): \(.reason // "?")"' 2>/dev/null >&2 || true
            fi
            break
        fi
    done

    echo "✅ ${LABEL} change requests done."
}

approve_and_commit clients

# Create admin user (approvers are created dynamically by tests)
TOKEN="$(get_admin_token)"
echo "👤 Creating admin user..."
curl -s $CURL_OPTS -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/users" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","email":"admin@tidecloak.com","firstName":"admin","lastName":"user","enabled":true,"emailVerified":false,"requiredActions":[],"attributes":{"locale":"","tideInvitable":"true"},"groups":[]}' > /dev/null 2>&1

approve_and_commit users

# Fetch adapter config
TOKEN="$(get_admin_token)"
echo "📥 Fetching adapter config…"
CLIENT_UUID=$(curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/clients?clientId=${CLIENT_NAME}" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

# Create output directory if it doesn't exist
mkdir -p "$(dirname "$ADAPTER_OUTPUT_PATH")"

curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/get-installations-provider?clientId=${CLIENT_UUID}&providerId=keycloak-oidc-keycloak-json" \
    -H "Authorization: Bearer $TOKEN" > "$ADAPTER_OUTPUT_PATH"

# Update the auth-server-url in the adapter config to use the external URL
if [ "$TIDECLOAK_LOCAL_URL" != "$TIDECLOAK_EXTERNAL_URL" ]; then
    log_info "Updating adapter config with external URL..."
    sed -i "s|$TIDECLOAK_LOCAL_URL|$TIDECLOAK_EXTERNAL_URL|g" "$ADAPTER_OUTPUT_PATH"
fi

echo "✅ Adapter config saved to $ADAPTER_OUTPUT_PATH"
log_info "  auth-server-url: $TIDECLOAK_EXTERNAL_URL"

# Fetch DPoP client adapter config
TOKEN="$(get_admin_token)"
echo "📥 Fetching DPoP adapter config…"
DPOP_CLIENT_UUID=$(curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/clients?clientId=${DPOP_CLIENT_NAME}" \
    -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id')

mkdir -p "$(dirname "$DPOP_ADAPTER_OUTPUT_PATH")"

curl -s $CURL_OPTS -X GET "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/vendorResources/get-installations-provider?clientId=${DPOP_CLIENT_UUID}&providerId=keycloak-oidc-keycloak-json" \
    -H "Authorization: Bearer $TOKEN" > "$DPOP_ADAPTER_OUTPUT_PATH"

# Inject useDPoP config
TMP_DPOP_JSON="$(mktemp)"
jq '. + {"useDPoP": {"mode": "strict", "alg": "ES256"}}' "$DPOP_ADAPTER_OUTPUT_PATH" > "$TMP_DPOP_JSON" && mv "$TMP_DPOP_JSON" "$DPOP_ADAPTER_OUTPUT_PATH"

if [ "$TIDECLOAK_LOCAL_URL" != "$TIDECLOAK_EXTERNAL_URL" ]; then
    sed -i "s|$TIDECLOAK_LOCAL_URL|$TIDECLOAK_EXTERNAL_URL|g" "$DPOP_ADAPTER_OUTPUT_PATH"
fi

echo "✅ DPoP adapter config saved to $DPOP_ADAPTER_OUTPUT_PATH"

rm -f "$TMP_REALM_JSON"

# Upload branding images (logo and background)
upload_branding() {
    echo "🎨 Uploading branding images..."
    TOKEN="$(get_admin_token)"

    if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
        log_warn "Failed to get token for branding upload"
        return 1
    fi

    # Look for images in public folder (relative to script dir's parent)
    local PUBLIC_DIR="${SCRIPT_DIR}/../public"

    # Upload logo if exists
    if [ -f "${PUBLIC_DIR}/logo.png" ]; then
        local logo_status
        logo_status=$(curl -s -k -o /dev/null -w "%{http_code}" \
            -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-idp-admin-resources/images/upload" \
            -H "Authorization: Bearer ${TOKEN}" \
            -F "fileData=@${PUBLIC_DIR}/logo.png" \
            -F "fileName=logo.png" \
            -F "fileType=LOGO" 2>/dev/null || echo "000")
        if [[ "$logo_status" =~ ^2 ]]; then
            echo "  ✅ Logo uploaded"
        else
            log_warn "Logo upload failed (HTTP $logo_status) - continuing anyway"
        fi
    else
        log_warn "Logo not found at ${PUBLIC_DIR}/logo.png - skipping"
    fi

    # Upload background if exists
    if [ -f "${PUBLIC_DIR}/background.png" ]; then
        local bg_status
        bg_status=$(curl -s -k -o /dev/null -w "%{http_code}" \
            -X POST "${TIDECLOAK_LOCAL_URL}/admin/realms/${REALM_NAME}/tide-idp-admin-resources/images/upload" \
            -H "Authorization: Bearer ${TOKEN}" \
            -F "fileData=@${PUBLIC_DIR}/background.png" \
            -F "fileName=background.png" \
            -F "fileType=BACKGROUND_IMAGE" 2>/dev/null || echo "000")
        if [[ "$bg_status" =~ ^2 ]]; then
            echo "  ✅ Background uploaded"
        else
            log_warn "Background upload failed (HTTP $bg_status) - continuing anyway"
        fi
    else
        log_warn "Background not found at ${PUBLIC_DIR}/background.png - skipping"
    fi

    echo "✅ Branding upload complete."
}

upload_branding

echo ""
echo "🎉 Tidecloak initialization complete!"
