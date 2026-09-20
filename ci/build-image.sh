#!/usr/bin/env bash
# Builds stack images with tidecloak-override's build-images.sh.
#
#   ci/build-image.sh tidecloak                     # local tag tide-ci/tidecloak:local
#   ci/build-image.sh all                           # all four, local only
#   EXPECTED_KEY=<key> ci/build-image.sh ork --push ghcr.io/tide-foundation/tide-ci
#
# With --push the image goes to <prefix>-<image>:<key>, and:
#   - EXPECTED_KEY (the plan's key) must match the key the build computed,
#     otherwise the shards would look for a tag that was never pushed
#   - the package must be private: an existing non-private package is refused,
#     and a package that is not private after the push fails the job
#     (GH_TOKEN needs read:packages for that check)
# Build output stays in $CI_BUILD_LOG_DIR, never in the public job log.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace

image="${1:-}"
case "$image" in tidecloak|master|ork|keygen|all) ;; *) die "usage: build-image.sh <tidecloak|master|ork|keygen|all> [--push <prefix>]" ;; esac
shift
prefix=""
if [ "${1:-}" = "--push" ]; then
    prefix="${2:-}"
    [ -n "$prefix" ] || die "--push needs a registry prefix"
    [ "$image" != all ] || die "push one image per call"
fi

override="$TIDE_WORKSPACE/tidecloak-override"
builder="$override/Tidified/ci/build-images.sh"
[ -f "$builder" ] || die "missing $builder (does that tidecloak-override ref have Tidified/ci?)"
export CI_BUILD_LOG_DIR="${CI_BUILD_LOG_DIR:-${RUNNER_TEMP:-/tmp}/tide-build-logs}"
mkdir -p "$CI_BUILD_LOG_DIR"
chmod 700 "$CI_BUILD_LOG_DIR"

if [ -z "$prefix" ]; then
    (cd "$override/Tidified/ci" && ./build-images.sh --image "$image")
    exit 0
fi

[[ "$prefix" =~ ^ghcr\.io/[a-z0-9._-]+/[a-z0-9._/-]+$ ]] || die "push prefix must look like ghcr.io/<org>/<name>, lowercase"
: "${EXPECTED_KEY:?set EXPECTED_KEY to the key from the plan}"
owner="${prefix#ghcr.io/}"
owner="${owner%%/*}"
package="${prefix#ghcr.io/"$owner"/}-$image"

visibility() {
    gh api "orgs/$owner/packages/container/${package//\//%2F}" --jq .visibility 2>/dev/null || echo none
}

before="$(visibility)"
case "$before" in
    private|none) ;;
    *) die "package $package is '$before'. Refusing to push an image built from private sources." ;;
esac

(cd "$override/Tidified/ci" && ./build-images.sh --image "$image" --push "$prefix")

built_key="$(node -e 'const c = require(process.argv[1]); process.stdout.write(c.images[process.argv[2]].key)' \
    "$CI_STACK_DIR/components.json" "$image")"
if [ "$built_key" != "$EXPECTED_KEY" ]; then
    echo "::error::$image was built with key $built_key but the plan expected $EXPECTED_KEY (checkout or TC_NPM_VERSION differs)"
    exit 1
fi

after="$(visibility)"
if [ "$after" != private ]; then
    echo "::error::package $package is '$after' after the push. Set it to private in the org's package settings now."
    exit 1
fi
log "pushed $prefix-$image:$built_key (package is private)"
