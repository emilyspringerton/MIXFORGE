#!/usr/bin/env bash
# bazel_dsp_test.sh -- real, sandboxable `bazel test //:dsp_test` wrapper for web/dsp_test.mjs.
#
# TEST_SRCDIR/TEST_WORKSPACE are real, standard Bazel test-runner env vars pointing at this
# test's own real runfiles tree (see BUILD.bazel's own :dsp_test doc comment for what's declared
# as `data`); falling back to a plain relative path covers running this script directly (not
# through `bazel test`) for local debugging.
set -euo pipefail
if [ -n "${TEST_SRCDIR:-}" ] && [ -n "${TEST_WORKSPACE:-}" ]; then
    cd "${TEST_SRCDIR}/${TEST_WORKSPACE}"
fi
exec node web/dsp_test.mjs
