#!/usr/bin/env bash
# bazel_serve_web.sh -- `bazel run //:serve-web` convenience wrapper for `python3 -m http.server`
# over web/, matching README.md's own "Run it" instructions exactly (open dj.html or
# multiplayer.html in a browser against this).
#
# Deliberately NOT a `bazel build`/`bazel test` action: a real, long-running, port-binding dev
# server doesn't belong inside a sandboxed Bazel action. Same real BUILD_WORKSPACE_DIRECTORY
# escape hatch every other non-hermetic wrapper in this file uses.
set -euo pipefail
if [ -z "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    echo "ERROR: BUILD_WORKSPACE_DIRECTORY not set -- run this via 'bazel run //:serve-web', not directly." >&2
    exit 1
fi
cd "${BUILD_WORKSPACE_DIRECTORY}/web"
exec python3 -m http.server 8000
