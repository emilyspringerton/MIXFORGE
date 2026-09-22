// room_smoke_test.mjs -- real, live execution proof for web/room.wasm, run in plain Node.js
// (no browser needed for CI). Same discipline PARENA's own examples/wasm/run_clamp_smoke.mjs
// established: an actual WebAssembly.instantiate + function call, not a structural/bytes check.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const bytes = readFileSync(path.join(here, "room.wasm"));
const { instance } = await WebAssembly.instantiate(bytes, {});
const { next_seat, is_valid_seat, max_seats } = instance.exports;

function assertEq(got, want, label) {
  if (got !== want) {
    console.error(`FAIL: ${label} = ${got}, expected ${want}`);
    process.exit(1);
  }
  console.log(`${label} = ${got}`);
}

assertEq(max_seats(), 4, "max_seats()");
assertEq(next_seat(0, 4), 1, "next_seat(0, 4)");
assertEq(next_seat(1, 4), 2, "next_seat(1, 4)");
assertEq(next_seat(2, 4), 3, "next_seat(2, 4)");
assertEq(next_seat(3, 4), 0, "next_seat(3, 4)  -- real wraparound, 'go around the room'");
assertEq(is_valid_seat(0, 4) ? 1 : 0, 1, "is_valid_seat(0, 4)");
assertEq(is_valid_seat(3, 4) ? 1 : 0, 1, "is_valid_seat(3, 4)");
assertEq(is_valid_seat(4, 4) ? 1 : 0, 0, "is_valid_seat(4, 4)  -- out of bounds");
assertEq(is_valid_seat(-1, 4) ? 1 : 0, 0, "is_valid_seat(-1, 4)  -- out of bounds");

console.log("room-smoke: PASS (real WebAssembly execution, not a structural check)");
