#!/usr/bin/env bash
# bazel_room_server.sh -- `bazel run //:room-server` convenience wrapper for `npm start` in
# server/ (server/room_server.mjs -- seat occupancy, join/leave, turn broadcast, YouTube track
# acquisition via yt-dlp).
#
# Deliberately NOT a `bazel build`/`bazel test` action: a real, long-running server process that
# binds a real port and shells out to a real yt-dlp binary does not belong inside a sandboxed
# Bazel action. Same real BUILD_WORKSPACE_DIRECTORY escape hatch MISHRI's own
# scripts/bazel_start.sh already uses. Run `bazel run //:room-install` first if node_modules/
# doesn't exist yet.
set -euo pipefail
if [ -z "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    echo "ERROR: BUILD_WORKSPACE_DIRECTORY not set -- run this via 'bazel run //:room-server', not directly." >&2
    exit 1
fi
cd "${BUILD_WORKSPACE_DIRECTORY}/server"
exec npm start
