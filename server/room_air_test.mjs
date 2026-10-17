// room_air_test.mjs -- "on air" stream relay, against a real server and real ws clients.
import { WebSocket } from "ws";
import { startServer } from "./room_server.mjs";

let failed = 0;
const assert = (c, l) => { if (!c) { failed++; console.error("FAIL:", l); } else console.log("OK:", l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.json = []; ws.bin = [];
    ws.on("message", (raw, isBinary) => { if (isBinary) ws.bin.push(Buffer.from(raw)); else ws.json.push(JSON.parse(raw.toString())); });
    ws.once("open", () => resolve(ws));
  });
}
const last = (ws, type) => [...ws.json].reverse().find((m) => m.type === type);
const send = (ws, m) => ws.send(JSON.stringify(m));

const { wss, room } = startServer(8990, "127.0.0.1", async () => ({ ok: false, error: "x" }), 60000);
const a = await client(8990), b = await client(8990), c = await client(8990);
await sleep(100);

a.send(Buffer.from([1, 2, 3]), { binary: true });
await sleep(60);
assert(b.bin.length === 0 && c.bin.length === 0, "binary frames from a seat that is not on air are dropped");

send(a, { type: "go_on_air", codec: "opus", sampleRate: 48000, channels: 2 });
await sleep(80);
const st = last(b, "onair_started");
assert(st && st.seat === 0 && st.codec === "opus" && st.sampleRate === 48000, "everyone is told who is on air and with what codec");
assert(last(c, "room_state").onAir === 0, "room_state carries onAir");

send(b, { type: "go_on_air", codec: "pcm16" });
await sleep(60);
assert(last(b, "onair_denied") && last(b, "onair_denied").onAir === 0 && room.onAir === 0, "a second DJ cannot take the air");

const frame = Buffer.from([1, 0, 0, 0, 7, 0, 0, 3, 192, 9, 9, 9]);
a.send(frame, { binary: true });
await sleep(80);
assert(b.bin.length === 1 && c.bin.length === 1 && b.bin[0].equals(frame), "on-air frames reach every listener verbatim");
assert(a.bin.length === 0, "the broadcaster does not get its own frames back");

b.send(Buffer.from([1, 1, 1]), { binary: true });
await sleep(60);
assert(a.bin.length === 0 && c.bin.length === 1, "a listener cannot inject frames");

a.send(Buffer.alloc(20 * 1024), { binary: true });
await sleep(60);
assert(b.bin.length === 1, "an oversized frame is dropped");

for (let i = 0; i < 60; i++) a.send(Buffer.alloc(8 * 1024), { binary: true });
await sleep(200);
assert(b.bin.length > 1 && b.bin.length < 61 && b.bin.length <= 1 + 32, `flooding is rate-limited (${b.bin.length - 1} of 60 8KB frames relayed in a burst)`);

const d = await client(8990);
await sleep(100);
assert(last(d, "onair_started") && last(d, "onair_started").seat === 0, "a late joiner is told the room is on air");
d.close();

send(a, { type: "off_air" });
await sleep(80);
assert(last(b, "onair_stopped") && room.onAir === -1 && last(c, "room_state").onAir === -1, "off_air clears it for everyone");

send(b, { type: "go_on_air", codec: "pcm16", sampleRate: 24000 });
await sleep(80);
assert(room.onAir === 1 && last(a, "onair_started").codec === "pcm16", "another DJ can go on air afterwards (pcm16 fallback announced)");
b.close();
await sleep(150);
assert(room.onAir === -1 && last(a, "onair_stopped"), "the broadcaster disconnecting takes the room off air");

a.close(); c.close(); wss.close();
console.log(failed ? `room_air_test: ${failed} FAILED` : "room_air_test: PASS");
process.exit(failed ? 1 : 0);
