#!/usr/bin/env bash
# build_room_wasm.sh -- real, reproducible build of web/room.wasm from PARENA/stdlib/mixforge/
# room.prn, mirroring PARENA's own `make wasm-smoke` recipe exactly (same llc -mtriple=wasm32-
# unknown-unknown + wasm-ld steps, same LLVM_TOOLCHAIN_ROOT convention). Needs a sibling
# ../PARENA checkout (same "sibling repo" convention this monorepo's own cross-repo PARENA
# consumers already use, e.g. EDITOR.GAME's own `make regenerate`).
set -euo pipefail
cd "$(dirname "$0")/.."

PARENA_ROOT="${PARENA_ROOT:-../PARENA}"
LLVM_TOOLCHAIN_ROOT="${LLVM_TOOLCHAIN_ROOT:-$HOME/.local/opt/llvm-toolchain}"
LLC="$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/bin/llc"
WASM_LD="$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/bin/wasm-ld"
export LD_LIBRARY_PATH="$LLVM_TOOLCHAIN_ROOT/usr/lib/x86_64-linux-gnu:$LLVM_TOOLCHAIN_ROOT/usr/lib/llvm-18/lib:${LD_LIBRARY_PATH:-}"

if [ ! -x "$PARENA_ROOT/parena" ]; then
  echo "build_room_wasm.sh: $PARENA_ROOT/parena not found -- build PARENA first (cd $PARENA_ROOT && make build)" >&2
  exit 1
fi
if [ ! -x "$LLC" ] || [ ! -x "$WASM_LD" ]; then
  echo "build_room_wasm.sh: llc/wasm-ld not found under $LLVM_TOOLCHAIN_ROOT -- see PARENA/docs/LLVM_BACKEND_NORTHSTAR.md for the no-sudo apt-get download + dpkg-deb -x recipe" >&2
  exit 1
fi

"$PARENA_ROOT/parena" build "$PARENA_ROOT/stdlib/mixforge/room.prn" -o web/room.ll
"$LLC" -mtriple=wasm32-unknown-unknown -filetype=obj web/room.ll -o web/room.o
"$WASM_LD" --no-entry --export-all --allow-undefined -o web/room.wasm web/room.o

node web/room_smoke_test.mjs
echo "build_room_wasm.sh: web/room.wasm built and verified"
