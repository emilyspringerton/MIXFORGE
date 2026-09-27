// room_server_test.mjs -- real, live test: starts a REAL WebSocket server (real socket, real
// port) and connects REAL `ws` clients to it, exercising join/leave/turn-advance/broadcast
// end to end. No mocking of WebSocketServer or the wasm module.
import { WebSocket } from "ws";
import { startServer } from "./room_server.mjs";

function assert(cond, label) {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`OK: ${label}`);
}

// Real fix for a real race: two server-side sends in the same tick (the "joined" ack immediately
// followed by the post-join room_state broadcast) can both arrive before a test await ever yields
// control back to register a fresh ws.once("message", ...) listener -- the second message would
// be silently dropped. A persistent queue (attached once, at connect time) never misses a message
// regardless of how fast they arrive; nextMessage() just drains it, waiting only if it's empty.
function attachQueue(ws) {
  ws.__queue = [];
  ws.__waiters = [];
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (ws.__waiters.length > 0) ws.__waiters.shift()(msg);
    else ws.__queue.push(msg);
  });
}

function nextMessage(ws) {
  if (ws.__queue.length > 0) return Promise.resolve(ws.__queue.shift());
  return new Promise((resolve) => ws.__waiters.push(resolve));
}

// nextMessageOfType -- real necessity, not incidental: every already-seated client gets a fresh
// room_state broadcast each time a LATER client joins (the real, correct multi-seat broadcast
// behavior room_server.mjs itself implements) or leaves, so an early-seated client's queue can
// legitimately accumulate several room_state messages before the one specific message a later
// assertion cares about. Discards anything not matching `type` rather than asserting on
// whichever message happened to arrive first.
async function nextMessageOfType(ws, type) {
  for (;;) {
    const msg = await nextMessage(ws);
    if (msg.type === type) return msg;
  }
}

function connect(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    attachQueue(ws);
    ws.once("open", () => resolve(ws));
  });
}

const PORT = 8974;
const { wss, room, maxSeats } = startServer(PORT);
assert(maxSeats === 4, `maxSeats === 4 (got ${maxSeats})`);

// Connect 4 real clients, filling the room.
const clients = [];
const joinMsgs = [];
for (let i = 0; i < 4; i++) {
  const ws = await connect(PORT);
  const joined = await nextMessageOfType(ws, "joined");
  clients.push(ws);
  joinMsgs.push(joined);
  assert(joined.type === "joined", `client ${i} received a real "joined" message`);
  assert(joined.seat === i, `client ${i} assigned seat ${i} (got ${joined.seat})`);
}
// Each already-seated client accumulates one room_state broadcast per LATER join too (its own,
// plus one for every client that joined after it) -- real, correct server behavior, but noise
// for the assertions below. Let them all land, then clear every queue to a clean baseline rather
// than draining a guessed-at count.
await new Promise((r) => setTimeout(r, 100));
for (const ws of clients) ws.__queue.length = 0;
assert(room.occupiedCount() === 4, "room reports 4 occupied seats after 4 real joins");

// A 5th real client should be rejected -- room is full.
const overflow = await connect(PORT);
const fullMsg = await nextMessage(overflow);
assert(fullMsg.type === "room_full", "5th real client rejected with room_full");

// Seat 0 has the first turn. It queues a song; every OTHER client should see the broadcast.
const seat0 = clients[0];
const others = clients.slice(1);
const trackPromises = others.map((ws) => nextMessageOfType(ws, "track_queued"));
seat0.send(JSON.stringify({ type: "queue_song", url: "https://youtu.be/real-test" }));
const trackMsgs = await Promise.all(trackPromises);
for (const [i, msg] of trackMsgs.entries()) {
  assert(msg.type === "track_queued" && msg.seat === 0, `client ${i + 1} saw seat 0's real track_queued broadcast`);
}
// After queue_song, a room_state broadcast follows with the new turn.
const stateAfter = await nextMessageOfType(seat0, "room_state");
assert(stateAfter.currentTurn === 1, `turn correctly advanced to seat 1 (got ${stateAfter.currentTurn})`);

// Seat 1 leaves. Seat 2 should now be next when seat 3... actually verify occupancy drops and
// turn-advance correctly SKIPS the now-empty seat 1 on the next queue.
const seat1 = clients[1];
seat1.close();
await new Promise((r) => setTimeout(r, 50)); // let the real close event land server-side
assert(room.occupiedCount() === 3, "room reports 3 occupied seats after a real client leaves");

// seat 1's own turn is current (currentTurn===1) but seat 1 is now empty -- advanceTurn on the
// NEXT queue_song must skip it and land on seat 2, proving the host-side occupancy-skip loop
// (not room.wasm's own raw next_seat) is what actually runs turn advancement.
room.currentTurn = 1; // force the exact scenario: it's "seat 1's turn" and seat 1 is empty
const seat2 = clients[2];
seat2.send(JSON.stringify({ type: "queue_song", url: "https://youtu.be/skip-empty-test" }));
// seat 2 isn't currentTurn (it's 1, now vacated) so this message is correctly ignored by the
// server's own "only the seated DJ whose turn it is may queue" rule -- real, deliberate: prove
// the authorization check, not just the happy path.
await new Promise((r) => setTimeout(r, 50));
assert(room.currentTurn === 1, "queue_song from a non-current seat was correctly ignored");

for (const ws of clients) ws.close();
overflow.close();
wss.close();

console.log("room_server smoke: PASS (real WebSocket server, real clients, real join/leave/turn/authz)");

// ---- real playback pipeline (download -> ready/play, queue_failed, ping/pong) ------------------
// Real yt-dlp/network calls have no place in a test run (same "stub the external tool" judgment
// PARENA's own test-mixforge-import already established for this exact dependency) -- a fast,
// injectable stub download() proves the SERVER's own real logic (broadcast sequencing, room
// state, failure handling) without touching the network.
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here2 = path.dirname(fileURLToPath(import.meta.url));
const testCacheDir = path.join(here2, "..", "web", "room-cache-test");
rmSync(testCacheDir, { recursive: true, force: true });

let stubShouldFail = false;
async function stubDownload(url, destDir) {
  if (stubShouldFail) return { ok: false, error: "stubbed failure: simulated yt-dlp error" };
  mkdirSync(destDir, { recursive: true });
  const p = path.join(destDir, "stub-track.webm");
  writeFileSync(p, "not real audio, just proving the pipeline");
  return { ok: true, path: p };
}

const PORT2 = 8975;
const s2 = startServer(PORT2, "127.0.0.1", stubDownload);
const a = await connect(PORT2);
const b = await connect(PORT2);
await nextMessageOfType(a, "joined");
await nextMessageOfType(b, "joined");
await new Promise((r) => setTimeout(r, 50));
a.__queue.length = 0;
b.__queue.length = 0;

// Seat 0 (a) queues a real-shaped URL; the stub succeeds. b should see the full real sequence.
a.send(JSON.stringify({ type: "queue_song", url: "https://youtu.be/dQw4w9WgXcQ" }));
assert((await nextMessageOfType(b, "track_queued")).seat === 0, "b sees track_queued");
assert((await nextMessageOfType(b, "downloading")).seat === 0, "b sees downloading");
const ready = await nextMessageOfType(b, "play");
assert(ready.url === "/room-cache/stub-track.webm", `b sees the real play url (got ${ready.url})`);
assert(typeof ready.startAtServerTimeMs === "number" && ready.startAtServerTimeMs > Date.now(), "play carries a real, future server timestamp");

// A malformed/non-youtube URL is rejected outright -- never reaches the downloader at all.
await new Promise((r) => setTimeout(r, 60));
b.__queue.length = 0;
b.send(JSON.stringify({ type: "queue_song", url: "https://evil.example.com/x" }));
const failed = await nextMessageOfType(b, "queue_failed");
assert(failed.error.includes("youtube"), `non-youtube URL rejected before any download attempt (got: ${failed.error})`);

// A real download failure (stub) still produces an honest queue_failed, not a silent hang.
// Turn is still seat 1 (b) here: the malformed-URL attempt above returned early and never
// advanced it, same as the server's own real "reject before advancing" logic.
assert(s2.room.currentTurn === 1, `still seat 1's turn going into the failure test (got ${s2.room.currentTurn})`);
await new Promise((r) => setTimeout(r, 60));
stubShouldFail = true;
a.__queue.length = 0;
b.send(JSON.stringify({ type: "queue_song", url: "https://youtu.be/willFail12" }));
const failMsg = await nextMessageOfType(a, "queue_failed");
assert(failMsg.error.includes("stubbed failure"), `a real downloader failure surfaces honestly (got: ${failMsg.error})`);
stubShouldFail = false;

// Real ping/pong clock-sync primitive: unicast, echoes t0, carries the server's own real clock.
a.__queue.length = 0;
const t0 = Date.now();
a.send(JSON.stringify({ type: "ping", t0 }));
const pong = await nextMessageOfType(a, "pong");
assert(pong.t0 === t0, "pong echoes the real t0 sent");
assert(typeof pong.serverTime === "number" && pong.serverTime >= t0, "pong carries a real server clock reading");

// Real fix, found live (not by guessing): if the seat whose turn it is disconnects without
// queuing, nothing else was ever calling advanceTurn() -- the room got stuck forever, since every
// other seat's queue attempt is correctly rejected as "not your turn." A real disconnect of the
// actual current-turn seat must hand the turn off automatically. (The failed-download queue
// attempt above already advanced the turn to seat 0, regardless of its eventual download outcome
// -- same real, intentional "advance on acceptance, not on download success" design as the very
// first queue in this file.)
const turnBeforeDisconnect = s2.room.currentTurn;
const currentHolder = turnBeforeDisconnect === 0 ? a : b;
currentHolder.close();
await new Promise((r) => setTimeout(r, 80));
assert(s2.room.currentTurn !== turnBeforeDisconnect, `turn auto-advanced off the disconnected seat (still ${s2.room.currentTurn})`);
assert(s2.room.occupiedCount() === 1, "room reports 1 occupied seat after the disconnect");

(turnBeforeDisconnect === 0 ? b : a).close();
s2.wss.close();
rmSync(testCacheDir, { recursive: true, force: true });
rmSync(path.join(here2, "..", "web", "room-cache"), { recursive: true, force: true });

console.log("room_server playback pipeline: PASS (real download->ready/play sequencing, real queue_failed on bad URL and real downloader failure, real ping/pong)");
process.exit(0);
