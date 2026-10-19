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
# up, so say loudly what is missing instead of stopping. The point of the
# warning is that a green run tells you nothing about licensing either way.
if [ -z "${STRIPE_TEST_SK:-}" ] && [ -z "${CI_ALLOW_NO_STRIPE:-}" ]; then
    annotate warning "STRIPE_TEST_SK is not set: licensing is UNCONFIGURED for this run, and a passing run is not evidence that licensing works"
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

# The ORKs send the account-recovery emails themselves, over SMTP. The image's
# appsettings only hold placeholders, so without this nothing is delivered and
# spec 13 (account recovery) cannot pass. ORK_SMTP_HOST picks any relay; with
# only GMAIL_ADDRESS + GMAIL_APP_PASSWORD set, the ORKs send through that Gmail
# account, the same one spec 13 reads. The values go into .env.ci (0600) and
# the override only references them, so it stays safe to print like
# compose.ci.yml.
compose_files=(-f "$compose")
smtp_host="${ORK_SMTP_HOST:-}"
smtp_user="${ORK_SMTP_USER:-}"
smtp_pass="${ORK_SMTP_PASSWORD:-}"
if [ -z "$smtp_host" ] && [ -n "${GMAIL_ADDRESS:-}" ] && [ -n "${GMAIL_APP_PASSWORD:-}" ]; then
    smtp_host=smtp.gmail.com
    smtp_user="$GMAIL_ADDRESS"
    smtp_pass="$GMAIL_APP_PASSWORD"
fi
if [ -n "$smtp_host" ]; then
    [ -n "$smtp_user" ] && [ -n "$smtp_pass" ] || die "ORK_SMTP_HOST is set but ORK_SMTP_USER or ORK_SMTP_PASSWORD is not"
    mask "$smtp_pass"
    smtp_port="${ORK_SMTP_PORT:-587}"
    [[ "$smtp_port" =~ ^[1-9][0-9]*$ ]] || die "ORK_SMTP_PORT must be a port number, got: $smtp_port"
    smtp_ssl="${ORK_SMTP_SSL:-true}"
    [[ "$smtp_ssl" =~ ^(true|false)$ ]] || die "ORK_SMTP_SSL must be true or false, got: $smtp_ssl"
    # Gmail rewrites any other From to the account anyway.
    smtp_from="${ORK_SMTP_FROM:-$smtp_user}"
    for v in "$smtp_host" "$smtp_user" "$smtp_pass" "$smtp_from"; do
        case "$v" in *"'"*|*$'\n'*|*$'\r'*) die "the ORK SMTP settings cannot contain a quote or a newline" ;; esac
    done
    {
        printf "ORK_SMTP_HOST='%s'\n" "$smtp_host"
        printf "ORK_SMTP_PORT='%s'\n" "$smtp_port"
        printf "ORK_SMTP_SSL='%s'\n" "$smtp_ssl"
        printf "ORK_SMTP_USER='%s'\n" "$smtp_user"
        printf "ORK_SMTP_PASSWORD='%s'\n" "$smtp_pass"
        printf "ORK_SMTP_FROM='%s'\n" "$smtp_from"
    } >> "$env_ci"
    smtp_compose="$CI_STACK_DIR/compose.smtp.yml"
    {
        echo "services:"
        for n in $(seq 1 "$(ork_count)"); do
            # shellcheck disable=SC2016  # compose fills these in, not bash
            printf '  ork%s:\n    environment:\n' "$n"
            printf '      %s\n' \
                'Email__SmtpClient: ${ORK_SMTP_HOST:?}' \
                'Email__OrkEmail: ${ORK_SMTP_FROM:?}' \
                'Email__NetworkCredentials__Username: ${ORK_SMTP_USER:?}' \
                'Email__NetworkCredentials__Password: ${ORK_SMTP_PASSWORD:?}' \
                'Email__NetworkCredentials__Port: ${ORK_SMTP_PORT:?}' \
                'Email__NetworkCredentials__EnableSsl: ${ORK_SMTP_SSL:?}'
        done
    } > "$smtp_compose"
    compose_files+=(-f "$smtp_compose")
    log "ORK recovery email: SMTP via $smtp_host:$smtp_port"
else
    log "ORK recovery email: no SMTP override (set ORK_SMTP_* or GMAIL_*), so recovery emails will not be delivered"
fi

# Never print `docker compose config`: it resolves the secrets.
start=$(date +%s)
docker compose -p "$COMPOSE_PROJECT_NAME" "${compose_files[@]}" --env-file "$env_ci" up -d --quiet-pull
log "compose up returned after $(( $(date +%s) - start ))s"
