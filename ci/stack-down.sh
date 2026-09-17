#!/usr/bin/env bash
# Stops the stack and removes its volumes. Safe to run when nothing is up.
# shellcheck source=lib/common.sh
source "$(dirname "$0")/lib/common.sh"
compose="$CI_STACK_DIR/compose.ci.yml"
env_ci="$CI_STACK_DIR/.env.ci"
project="${COMPOSE_PROJECT_NAME:-}"
if [ -z "$project" ] && [ -f "$CI_STACK_DIR/stack.env" ]; then
    project="$(env_file_get "$CI_STACK_DIR/stack.env" COMPOSE_PROJECT_NAME || true)"
fi
if [ -f "$compose" ]; then
    args=(-p "${project:-tide-ci}" -f "$compose")
    if [ -f "$env_ci" ]; then args+=(--env-file "$env_ci"); fi
    docker compose "${args[@]}" down -v --remove-orphans || true
fi
