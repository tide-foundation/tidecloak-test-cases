#!/usr/bin/env bash
# Frees space on a GitHub-hosted Ubuntu runner (about 14 GB free out of the box).
#   light: Android SDK, Haskell, CodeQL bundles, preloaded Docker images (~20 GB)
#   full:  light plus Swift, PowerShell, Boost, Julia, and the Chromium/Firefox the
#          image ships (Playwright installs its own) (~6 GB more)
# Java, .NET and Node are kept; the setup-* steps pick the versions we pin.
set -euo pipefail
level="${1:-light}"

df -h / | tail -n 1 | awk '{print "[ci] disk free before: " $4}'
remove() {
    for p in "$@"; do
        if [ -e "$p" ]; then
            echo "[ci] removing $p"
            sudo rm -rf "$p"
        fi
    done
}

remove /usr/local/lib/android /opt/ghc /usr/local/.ghcup /opt/hostedtoolcache/CodeQL
if command -v docker >/dev/null; then
    docker image prune --all --force >/dev/null || true
fi
if [ "$level" = "full" ]; then
    remove /usr/share/swift /usr/local/share/powershell /usr/local/share/boost \
        /usr/local/julia* /usr/local/share/chromium /opt/microsoft/msedge /usr/lib/firefox
fi
df -h / | tail -n 1 | awk '{print "[ci] disk free after: " $4}'
