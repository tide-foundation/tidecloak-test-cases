# Create a TideCloak User by Hand (Steps 1 & 2)

How to create a user and commit it through the IGA change-request flow using only
raw Admin REST calls. This replicates `tests/scripts/handover-admin.sh` steps
`create_user` + `approve_and_commit`.

## Prerequisites

- TideCloak reachable (default `http://localhost:8080`).
- Admin credentials for the **master** realm (default `admin` / `password`).
- The target **realm ID** (a UUID, not the display name). Find it in
  `test-app/data/tidecloak.json` → `.realm`, or via the admin console.
- `curl` and `jq` installed.
- The ORK network must be healthy — the commit (step 2c) asks the ORKs to sign the
  attestation. If too few ORKs are up you'll get `HTTP 500`
  (`Not enough orks returned an ok response`); just retry once they're up.

## Set your environment values

These three differ per computer/stack — set them once:

```bash
export URL=http://localhost:8080                          # TideCloak base URL
export REALM=f622c854-45c5-49a7-90de-4730dd5657b4         # realm ID (UUID)
export KC_USER=admin
export KC_PASSWORD=password
export USERNAME=manual_user                               # the user to create
```

> If `URL` is `https://…`, add `-k` to every `curl` for a self-signed cert.

---

## Step 1 — Create the user (`create_user`)

### 1a. Get an admin token

The token is short-lived (~60s) — grab a fresh one at the start of each step.

```bash
export TOKEN=$(curl -s -X POST "$URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$KC_USER" -d "password=$KC_PASSWORD" \
  -d "grant_type=password" -d "client_id=admin-cli" | jq -r .access_token)
```

### 1b. Check the user doesn't already exist

```bash
curl -s "$URL/admin/realms/$REALM/users?username=$USERNAME" \
  -H "Authorization: Bearer $TOKEN" | jq -r '.[0].id // "<none>"'
```

Expect `<none>`. If it returns an ID, the user already exists — stop.

### 1c. Create the user

The `tideInvitable: "true"` attribute is required for later Tide-account linking.

```bash
curl -s -X POST "$URL/admin/realms/$REALM/users" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"username\":\"$USERNAME\",\"email\":\"$USERNAME@tidecloak.com\",\"firstName\":\"$USERNAME\",\"lastName\":\"user\",\"enabled\":true,\"emailVerified\":false,\"requiredActions\":[],\"attributes\":{\"locale\":\"\",\"tideInvitable\":\"true\"},\"groups\":[]}" \
  -w "\nHTTP %{http_code}\n"
```

**Expected: `HTTP 202`** with a body like:

```json
{ "status": "PENDING",
  "changeRequestId": "8544b321-3cd1-4aa1-9ba8-04aac5c7553b",
  "entityType": "USER", "actionType": "CREATE_USER" }
```

With IGA enabled the user record is written but its creation is **gated behind a
change request** — it is not active until committed in step 2. Copy the
`changeRequestId`:

```bash
export CR=8544b321-3cd1-4aa1-9ba8-04aac5c7553b   # <- paste the id from above
```

> Note: a plain Keycloak (no IGA) returns `HTTP 201` here and you can skip step 2.

---

## Step 2 — Approve & commit (`approve_and_commit`)

### 2a. (Optional) Confirm the change request is pending

```bash
export TOKEN=$(curl -s -X POST "$URL/realms/master/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "username=$KC_USER" -d "password=$KC_PASSWORD" \
  -d "grant_type=password" -d "client_id=admin-cli" | jq -r .access_token)

curl -s "$URL/admin/realms/$REALM/iga/change-requests?status=PENDING" \
  -H "Authorization: Bearer $TOKEN" | jq '[.[] | {id, actionType, status}]'
```

Your `CREATE_USER` CR (`$CR`) should be in the list.

### 2b. Authorize (record this admin's approval)

```bash
curl -s -X POST "$URL/admin/realms/$REALM/iga/change-requests/$CR/authorize" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{}' -w "\nHTTP %{http_code}\n"
```

**Expected: `HTTP 200`**, response shows `"readyToCommit": true` and
`"authorizationCount": 1` (firstAdmin mode, `threshold: 1`).
`HTTP 409` means it's already authorized — fine, continue.

### 2c. Commit (apply / ORK-sign)

```bash
curl -s -X POST "$URL/admin/realms/$REALM/iga/change-requests/$CR/commit" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -w "\nHTTP %{http_code}\n"
```

**Expected: `HTTP 200`**, response shows `"status": "APPROVED"` with a
`resolvedAt` timestamp. The user is now fully created.

- `HTTP 412` — dependency/threshold not yet met; authorize the dependency first, retry.
- `HTTP 500` (`Not enough orks…`) — ORK network unhealthy; retry once ORKs are up.

### Verify

```bash
curl -s "$URL/admin/realms/$REALM/users?username=$USERNAME" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0] | {id, username, enabled, email, attributes}'
```

---

## Endpoint summary

| Step | Method & path | Expected |
|------|---------------|----------|
| 1a   | `POST /realms/master/protocol/openid-connect/token` | admin JWT |
| 1b   | `GET  /admin/realms/{realm}/users?username={u}` | `<none>` |
| 1c   | `POST /admin/realms/{realm}/users` | `202` + `changeRequestId` |
| 2a   | `GET  /admin/realms/{realm}/iga/change-requests?status=PENDING` | CR listed |
| 2b   | `POST /admin/realms/{realm}/iga/change-requests/{id}/authorize` | `200`, `readyToCommit:true` |
| 2c   | `POST /admin/realms/{realm}/iga/change-requests/{id}/commit` | `200`, `status:APPROVED` |

> Not covered here: **step 3** (`get_tide_invite_link`) and the user actually
> linking their Tide account — those come after the user is committed.
