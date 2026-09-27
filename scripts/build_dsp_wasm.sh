#!/usr/bin/env bash
# build_dsp_wasm.sh -- builds web/dsp.wasm, the 4-track mixer + MIDI sampler DSP, from
# PARENA/stdlib/mixforge/mixer.prn + sampler.prn. Same pipeline as build_room_wasm.sh (parena
# build -> LLVM IR -> llc -mtriple=wasm32-unknown-unknown -> wasm-ld); the two objects link into
# ONE module so the AudioWorklet instantiates a single thing. Then runs the DSP test suite.
#
# Finds llc/wasm-ld under LLVM_TOOLCHAIN_ROOT (the no-sudo extracted toolchain PARENA's own
# docs/LLVM_BACKEND_NORTHSTAR.md describes) if present, else on PATH (e.g. apt's llvm-18/lld-18).
set -euo pipefail
cd "$(dirname "$0")/.."

PARENA_ROOT="${PARENA_ROOT:-../PARENA}"
LLVM_TOOLCHAIN_ROOT="${LLVM_TOOLCHAIN_ROOT:-$HOME/.local/opt/llvm-toolchain}"
if [ -x "$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/bin/llc" ]; then
  LLC="$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/bin/llc"
  WASM_LD="$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/bin/wasm-ld"
  export LD_LIBRARY_PATH="$LLVM_TOOLCHAIN_ROOT/usr/lib/x86_64-linux-gnu:$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/lib:${LD_LIBRARY_PATH:-}"
else
  LLC="$(command -v llc || true)"
  WASM_LD="$(command -v wasm-ld || true)"
fi

if [ ! -x "$PARENA_ROOT/parena" ]; then
  echo "build_dsp_wasm.sh: $PARENA_ROOT/parena not found -- build PARENA first (cd $PARENA_ROOT && make build)" >&2
  exit 1
fi
if [ -z "$LLC" ] || [ -z "$WASM_LD" ]; then
  echo "build_dsp_wasm.sh: llc/wasm-ld not found (LLVM_TOOLCHAIN_ROOT or PATH)" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
for mod in mixer sampler; do
  "$PARENA_ROOT/parena" build "$PARENA_ROOT/stdlib/mixforge/$mod.prn" -o "$tmp/$mod.ll"
  "$LLC" -O2 -mtriple=wasm32-unknown-unknown -filetype=obj "$tmp/$mod.ll" -o "$tmp/$mod.o"
done
"$WASM_LD" --no-entry --export-all --allow-undefined -o web/dsp.wasm "$tmp/mixer.o" "$tmp/sampler.o"

node web/dsp_test.mjs
echo "build_dsp_wasm.sh: web/dsp.wasm built and verified"
