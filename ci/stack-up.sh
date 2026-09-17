#!/usr/bin/env bash
# Generates the stack config and starts it, without waiting for it to be ready
# (ci/stack-wait.sh does that), so other setup can run while it boots.
# Exports the non-secret stack.env values and the admin password (masked first).
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace

scripts="$TIDE_WORKSPACE/tidecloak-override/Tidified/ci"
mkdir -p "$CI_STACK_DIR"
chmod 700 "$CI_STACK_DIR"

# gen-stack.sh needs the Stripe settings. Without a key the stack still comes
# up, but licensing flows fail, so say so loudly instead of stopping.
if [ -z "${STRIPE_TEST_SK:-}" ] && [ -z "${CI_ALLOW_NO_STRIPE:-}" ]; then
    echo "::warning::STRIPE_TEST_SK is not set; starting the stack without Stripe (licensing flows will fail)"
    export CI_ALLOW_NO_STRIPE=true
fi

(cd "$scripts" && ./gen-stack.sh)

env_ci="$CI_STACK_DIR/.env.ci"
stack_env="$CI_STACK_DIR/stack.env"
compose="$CI_STACK_DIR/compose.ci.yml"
for f in "$env_ci" "$stack_env" "$compose"; do
    [ -f "$f" ] || die "gen-stack.sh did not write $f"
done

# The admin password lives in .env.ci. Mask it before anything else sees it.
pw_var="${CI_ADMIN_PASSWORD_VAR:-KC_ADMIN_PASSWORD}"
pw="$(env_file_get "$env_ci" "$pw_var" || env_file_get "$env_ci" KC_BOOTSTRAP_ADMIN_PASSWORD || true)"
[ -n "$pw" ] || die "no $pw_var (or KC_BOOTSTRAP_ADMIN_PASSWORD) in .env.ci"
mask "$pw"
set_env KC_ADMIN_PASSWORD "$pw"

# stack.env is non-secret by contract; export it as-is, one KEY=VALUE per line.
while IFS= read -r line || [ -n "$line" ]; do
    line="${line#export }"
    case "$line" in ''|'#'*) continue ;; esac
    key="${line%%=*}"
    [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "unexpected line in stack.env: $key"
    case "$key" in *PASSWORD*|*SECRET*|*TOKEN*) die "stack.env must not hold secrets, found $key" ;; esac
    value="${line#*=}"
    case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
    esac
    set_env "$key" "$value"
done < "$stack_env"

# The names the suites read, mapped from stack.env.
set_env TIDECLOAK_URL "${TIDECLOAK_URL:-http://localhost:8080}"
set_env KC_BASE_URL "${KC_BASE_URL:-$TIDECLOAK_URL}"
set_env HOME_ORK_ORIGIN "${HOME_ORK_ORIGIN:-http://localhost:1001}"
set_env KC_ADMIN_USER "${KC_ADMIN_USER:-admin}"
set_env KC_CONTAINER "${TIDECLOAK_CONTAINER:-tidecloakP}"
set_env PG_CONTAINER "${POSTGRES_CONTAINER:-postgresP}"
set_env ORK_CONTAINERS "${ORK_CONTAINERS:-Ork-1,Ork-2,Ork-3,Ork-4,Ork-5}"
set_env COMPOSE_PROJECT_NAME "${COMPOSE_PROJECT_NAME:-tide-ci}"

# Never print `docker compose config`: it resolves the secrets.
start=$(date +%s)
docker compose -p "$COMPOSE_PROJECT_NAME" -f "$compose" --env-file "$env_ci" up -d --quiet-pull
log "compose up returned after $(( $(date +%s) - start ))s"
