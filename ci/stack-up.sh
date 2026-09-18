#!/usr/bin/env bash
# Generates the stack config and starts it, without waiting for it to be ready
# (ci/stack-wait.sh does that), so other setup can run while it boots.
# Exports the non-secret stack.env values and the admin password (masked first).
#
# Stack size comes from the environment and is passed straight through to
# gen-stack.sh: ORK_COUNT (default 5), TIDE_THRESHOLD_T/N (default 3/5). The
# pre-release gate runs 20 ORKs at T=14/N=20.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace

scripts="$TIDE_WORKSPACE/tidecloak-override/Tidified/ci"
mkdir -p "$CI_STACK_DIR"
chmod 700 "$CI_STACK_DIR"

# gen-stack.sh needs the Stripe settings. Without a key the stack still comes
# up, but licensing flows fail, so say so loudly instead of stopping.
if [ -z "${STRIPE_TEST_SK:-}" ] && [ -z "${CI_ALLOW_NO_STRIPE:-}" ]; then
    annotate warning "STRIPE_TEST_SK is not set; starting the stack without Stripe (licensing flows will fail)"
    export CI_ALLOW_NO_STRIPE=true
fi

# Check the size before spending 10 minutes on a stack that cannot reach quorum.
for v in ORK_COUNT TIDE_THRESHOLD_T TIDE_THRESHOLD_N; do
    if [ -n "${!v:-}" ]; then
        [[ "${!v}" =~ ^[1-9][0-9]*$ ]] || die "$v must be a positive whole number, got: ${!v}"
    fi
done
if [ -n "${TIDE_THRESHOLD_T:-}" ] && [ -n "${TIDE_THRESHOLD_N:-}" ]; then
    [ "$TIDE_THRESHOLD_T" -le "$TIDE_THRESHOLD_N" ] || die "TIDE_THRESHOLD_T ($TIDE_THRESHOLD_T) is above TIDE_THRESHOLD_N ($TIDE_THRESHOLD_N)"
    if [ -n "${ORK_COUNT:-}" ] && [ "$TIDE_THRESHOLD_N" -gt "$ORK_COUNT" ]; then
        die "TIDE_THRESHOLD_N ($TIDE_THRESHOLD_N) needs more ORKs than ORK_COUNT ($ORK_COUNT)"
    fi
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

# stack.env is non-secret by contract and describes the stack that was just
# generated, so it wins over whatever the caller had set.
load_stack_env "$stack_env" || die "gen-stack.sh did not write $stack_env"
stack_defaults
log "stack: $(ork_count) ORKs ($ORK_CONTAINERS), home ORK $HOME_ORK_ORIGIN, threshold ${TIDE_THRESHOLD_T:-?} of ${TIDE_THRESHOLD_N:-?}"

# Never print `docker compose config`: it resolves the secrets.
start=$(date +%s)
docker compose -p "$COMPOSE_PROJECT_NAME" -f "$compose" --env-file "$env_ci" up -d --quiet-pull
log "compose up returned after $(( $(date +%s) - start ))s"
