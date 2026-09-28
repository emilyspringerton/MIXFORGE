#!/usr/bin/env bash
# bazel_room_install.sh -- `bazel run //:room-install` convenience wrapper for `npm install` in
# server/ (the DJ-room WebSocket server's only real dependency, `ws`).
#
# Deliberately NOT a `bazel build`/`bazel test` action: real `npm install` needs real network
# access, which a real, sandboxed Bazel action doesn't get (and shouldn't -- side-effecting
# node_modules installation isn't a hermetic build output). Same real BUILD_WORKSPACE_DIRECTORY
# escape hatch MISHRI's own scripts/bazel_install.sh already uses.
set -euo pipefail
if [ -z "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    echo "ERROR: BUILD_WORKSPACE_DIRECTORY not set -- run this via 'bazel run //:room-install', not directly." >&2
    exit 1
fi
cd "${BUILD_WORKSPACE_DIRECTORY}/server"
exec npm install
