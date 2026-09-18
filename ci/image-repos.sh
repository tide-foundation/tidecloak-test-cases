#!/usr/bin/env bash
# Prints the repos an image is built from, as tidecloak-override defines them.
#   ci/image-repos.sh tidecloak [master ...]
# Needs $TIDE_WORKSPACE/tidecloak-override checked out.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
lib="$TIDE_WORKSPACE/tidecloak-override/Tidified/ci/lib.sh"
[ -f "$lib" ] || die "missing $lib"
for image in "$@"; do
    # shellcheck source=/dev/null
    (source "$lib" && image_repos "$image")
done | tr ' ' '\n' | sed '/^$/d' | sort -u | tr '\n' ' '
echo
