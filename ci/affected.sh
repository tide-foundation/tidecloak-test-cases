#!/usr/bin/env bash
# Prints which images a change touches and which suites it should run.
#
#   ci/affected.sh --component ork src/Foo.cs src/Bar.cs
#   git diff --name-only a..b | ci/affected.sh --component tide-js --stdin
#   ci/affected.sh --component heimdall             # no paths: every rule for that repo
#   ci/affected.sh --refs "ork=feat-x tide-js=main"  # repos not on their default ref
#   ci/affected.sh --all
#
# Output:
#   images=master,ork
#   suites=iga-engine,test-cases,...
# The rules live in ci/affected.tsv. Image keys in the plan job decide what
# actually gets rebuilt; the images line here is for people reading the plan.
# shellcheck disable=SC2034  # want_* are read through a nameref, which shellcheck cannot see
set -euo pipefail

CI_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RULES="${AFFECTED_RULES:-$CI_DIR/affected.tsv}"
COMPONENTS="${AFFECTED_COMPONENTS:-$CI_DIR/components.tsv}"
ALL_SUITES="iga-engine test-cases admin-bootstrap admin-runtime docs"
ALL_IMAGES="tidecloak master ork keygen"

component=""
refs=""
all=0
stdin=0
paths=()
while [ $# -gt 0 ]; do
    case "$1" in
        --component) component=${2:-}; shift 2 ;;
        --refs) refs=${2:-}; shift 2 ;;
        --all) all=1; shift ;;
        --stdin) stdin=1; shift ;;
        -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
        --) shift; paths+=("$@"); break ;;
        -*) echo "unknown option: $1" >&2; exit 2 ;;
        *) paths+=("$1"); shift ;;
    esac
done

if [ "$stdin" = 1 ]; then
    while IFS= read -r p; do
        if [ -n "$p" ]; then paths+=("$p"); fi
    done
fi

known_component() {
    awk -v c="$1" '!/^#/ && NF && $1 == c { found = 1 } END { exit !found }' "$COMPONENTS"
}

default_ref() {
    awk -v c="$1" '!/^#/ && NF && $1 == c { print $3 }' "$COMPONENTS"
}

# Filled by add(), read through a nameref in join_ordered.
declare -A want_images=() want_suites=()

add() {
    local images=$1 suites=$2 x
    if [ "$images" = "all" ]; then images="$ALL_IMAGES"; fi
    if [ "$suites" = "all" ]; then suites="$ALL_SUITES"; fi
    for x in ${images//,/ }; do
        if [ "$x" != "-" ]; then want_images[$x]=1; fi
    done
    for x in ${suites//,/ }; do
        if [ "$x" != "-" ]; then want_suites[$x]=1; fi
    done
    return 0
}

# First matching row for one path.
match_path() {
    local comp=$1 path=$2 c g i s
    while read -r c g i s; do
        case "$c" in ''|'#'*) continue ;; esac
        [ "$c" = "*" ] || [ "$c" = "$comp" ] || continue
        # shellcheck disable=SC2053  # the glob is meant to match
        if [[ "$path" == $g ]]; then
            add "$i" "$s"
            return 0
        fi
    done < "$RULES"
    echo "no rule matches $comp:$path" >&2
    return 1
}

# Union of every row for a component (used when no paths are known).
match_component() {
    local comp=$1 c g i s
    while read -r c g i s; do
        case "$c" in ''|'#'*) continue ;; esac
        [ "$c" = "$comp" ] && add "$i" "$s"
    done < "$RULES"
    return 0
}

need_known() {
    known_component "$1" || { echo "unknown component: $1 (see $COMPONENTS)" >&2; exit 2; }
}

if [ "$all" = 1 ]; then
    add all all
fi

if [ -n "$component" ]; then
    need_known "$component"
    if [ ${#paths[@]} -eq 0 ]; then
        match_component "$component"
    else
        for p in "${paths[@]}"; do
            p="${p#./}"
            match_path "$component" "$p"
        done
    fi
fi

for pair in ${refs//,/ }; do
    name="${pair%%=*}"
    ref="${pair#*=}"
    [ -n "$name" ] && [ "$name" != "$pair" ] || { echo "bad ref pair: $pair (want name=ref)" >&2; exit 2; }
    need_known "$name"
    if [ "$ref" != "$(default_ref "$name")" ]; then
        match_component "$name"
    fi
done

if [ "$all" = 0 ] && [ -z "$component" ] && [ -z "$refs" ]; then
    echo "nothing to check: pass --component, --refs or --all" >&2
    exit 2
fi

join_ordered() {
    local order=$1 out="" x
    shift
    local -n set=$1
    for x in $order; do
        if [ -n "${set[$x]:-}" ]; then out="${out:+$out,}$x"; fi
    done
    printf '%s' "$out"
}

echo "images=$(join_ordered "$ALL_IMAGES" want_images)"
echo "suites=$(join_ordered "$ALL_SUITES" want_suites)"
