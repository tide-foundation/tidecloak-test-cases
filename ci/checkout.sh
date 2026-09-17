#!/usr/bin/env bash
# Shallow-clones components into $TIDE_WORKSPACE at the SHAs the plan resolved.
#
#   CI_SHAS='{"ork":"<sha>",...}' GH_TOKEN=... ci/checkout.sh ork tide-js
#
# The token is passed to git through env, so nothing is written to .git/config
# and nothing lands in argv.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
need_workspace
[ -n "${CI_SHAS:-}" ] || die "CI_SHAS (JSON of component -> sha) is required"
[ $# -gt 0 ] || die "name at least one component"

if [ -n "${GH_TOKEN:-}" ]; then
    basic="$(printf 'x-access-token:%s' "$GH_TOKEN" | base64 -w0)"
    mask "$basic"
    export GIT_CONFIG_COUNT=1
    export GIT_CONFIG_KEY_0="http.https://github.com/.extraheader"
    export GIT_CONFIG_VALUE_0="AUTHORIZATION: basic $basic"
fi
export GIT_TERMINAL_PROMPT=0

for name in "$@"; do
    row="$(awk -v c="$name" '!/^#/ && NF && $1 == c { print $2, $4 }' "$CI_DIR/components.tsv")"
    [ -n "$row" ] || die "unknown component: $name"
    read -r repo submodules <<< "$row"
    sha="$(node -e 'const s = JSON.parse(process.env.CI_SHAS); process.stdout.write(s[process.argv[1]] || "")' "$name")"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || die "no resolved SHA for $name"

    dest="$TIDE_WORKSPACE/$name"
    if [ -d "$dest/.git" ] && [ "$(git -C "$dest" rev-parse HEAD 2>/dev/null)" = "$sha" ]; then
        log "$name already at ${sha:0:12}"
        continue
    fi
    rm -rf "$dest"
    mkdir -p "$dest"
    log "checking out $repo at ${sha:0:12} into $dest"
    git -C "$dest" init -q
    git -C "$dest" remote add origin "https://github.com/$repo.git"
    git -C "$dest" fetch -q --depth 1 --no-tags origin "$sha"
    git -C "$dest" -c advice.detachedHead=false checkout -q FETCH_HEAD
    if [ "$submodules" = "yes" ]; then
        git -C "$dest" submodule update -q --init --recursive --depth 1
    fi
done
