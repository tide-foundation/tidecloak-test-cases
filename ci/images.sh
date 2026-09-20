#!/usr/bin/env bash
# Gets the four stack images onto this machine and exports TC_IMAGE,
# MASTER_IMAGE, ORK_IMAGE and KEYGEN_IMAGE for gen-stack.sh.
#
#   IMAGE_REFS='{"tidecloak":"ghcr.io/...:<key>",...}' ci/images.sh pull
#   ci/images.sh build-local        # build all four here, nothing pushed
#
# pull expects `docker login ghcr.io` to have been done already.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"

mode="${1:-}"
images=(tidecloak master ork keygen)
local_tag() { printf 'tide-ci/%s:local' "$1"; }

case "$mode" in
    pull)
        [ -n "${IMAGE_REFS:-}" ] || die "IMAGE_REFS is required for pull"
        for image in "${images[@]}"; do
            ref="$(node -e 'process.stdout.write(JSON.parse(process.env.IMAGE_REFS)[process.argv[1]] || "")' "$image")"
            [ -n "$ref" ] || die "no image ref for $image"
            start=$(date +%s)
            docker pull --quiet "$ref" >/dev/null
            docker tag "$ref" "$(local_tag "$image")"
            log "pulled $image in $(( $(date +%s) - start ))s"
        done
        ;;
    build-local)
        "$CI_DIR/build-image.sh" all
        ;;
    *) die "usage: images.sh pull|build-local" ;;
esac

set_env TC_IMAGE "$(local_tag tidecloak)"
set_env MASTER_IMAGE "$(local_tag master)"
set_env ORK_IMAGE "$(local_tag ork)"
set_env KEYGEN_IMAGE "$(local_tag keygen)"
# Keys are made with the keygen image, so shards need no .NET or private source.
set_env CI_TOOLKIT docker
