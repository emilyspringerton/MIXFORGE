#!/usr/bin/env bash
# bazel_build_wasm.sh -- `bazel run //:build-wasm` convenience wrapper for scripts/build_dsp_wasm.sh.
#
# Deliberately NOT a `bazel build`/`bazel test` action: a real wasm build needs a sibling
# ../PARENA checkout already built (`cd ../PARENA && make build`) plus llc/wasm-ld on PATH or
# LLVM_TOOLCHAIN_ROOT -- none of that belongs inside a sandboxed, hermetic Bazel action. `bazel
# run` targets get BUILD_WORKSPACE_DIRECTORY, a real, standard Bazel env var pointing at the
# actual source tree (not a sandboxed copy) -- exactly the real escape hatch this kind of
# non-hermetic step is meant to use (same pattern MISHRI's own scripts/bazel_install.sh uses).
set -euo pipefail
if [ -z "${BUILD_WORKSPACE_DIRECTORY:-}" ]; then
    echo "ERROR: BUILD_WORKSPACE_DIRECTORY not set -- run this via 'bazel run //:build-wasm', not directly." >&2
    exit 1
fi
cd "${BUILD_WORKSPACE_DIRECTORY}"
exec ./scripts/build_dsp_wasm.sh
