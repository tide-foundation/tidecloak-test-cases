#!/usr/bin/env bash
# The stack's configs point at "hostgateway"; on the runner that is this machine.
set -euo pipefail
if ! grep -Eq '^[^#]*[[:space:]]hostgateway([[:space:]]|$)' /etc/hosts; then
    echo '127.0.0.1 hostgateway' | sudo tee -a /etc/hosts >/dev/null
fi
getent hosts hostgateway
