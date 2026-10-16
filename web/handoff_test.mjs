// handoff_test.mjs -- the deck chain in engine.mjs: a lone deck loops, a second deck makes the head
// play out and hand off (equal-power blend or hard cut), the finished deck empties, skip/remove
// behave, and a pad can sample the master mix. Real MixEngine + real dsp.wasm, headless; the
// engine runs at 8 kHz so a "track" is a few thousand samples and the whole file takes ~1s.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MixEngine, instantiateDsp } from "./engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dsp = instantiateDsp(readFileSync(path.join(here, "dsp.wasm")));
const SR = 8000, BLOCK = 128;

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}

function tone(freq, secs) {
  const L = new Float32Array(Math.floor(SR * secs));
  for (let k = 0; k < L.length; k++) L[k] = 0.5 * Math.sin((2 * Math.PI * freq * k) / SR);
  return L;
}
function rig(mode = "blend", secs = 2) {
  const e = new MixEngine(dsp, SR);
  e.handoffMode = mode; e.handoffSecs = secs;
  return e;
}
const load = (e, i, secs, ticket, freq = 220 * (i + 1)) => e.loadDeck(i, tone(freq, secs), null, SR, "d" + i, ticket);
function run(e, secs, each) {
  const L = new Float32Array(BLOCK), R = new Float32Array(BLOCK);
  for (let done = 0; done < secs * SR; done += BLOCK) { e.process(L, R, BLOCK); each && each(e); }
}
const kinds = (e, snap) => snap.map((x) => x.kind).join(",");

console.log("chain basics");
{
  const e = rig();
  load(e, 0, 3, 1); e.setDeck(0, "playing", true);
  check("chain is the ticketed, loaded decks", e.chainOrder().join() === "0");
  run(e, 7);
  check("a lone deck loops forever", e.decks[0].playing && e.decks[0].loop && e.events.length === 0);
  load(e, 2, 3, 5); load(e, 1, 3, 3);
  check("chain sorts by ticket, not by deck index", e.chainOrder().join() === "0,1,2");
  check("a second deck stops the head looping", (run(e, 0.01), !e.decks[0].loop));
}

console.log("blend hand-off");
{
  const e = rig("blend", 2);
  load(e, 0, 6, 1); load(e, 1, 6, 2); e.setDeck(0, "playing", true);
  e.decks[0].pos = 3 * SR; // 3s left, blend is 2s
  const sums = [];
  let started = -1, ended = -1, t = 0;
  run(e, 4, (en) => {
    t += BLOCK / SR;
    if (en.blend) sums.push(en.decks[0].blendGain ** 2 + en.decks[1].blendGain ** 2);
    for (const ev of en.events) { if (ev.kind === "blend" && started < 0) started = t; if (ev.kind === "handoff") ended = t; }
    en.events.length = 0;
  });
  check("blend starts when the head is handoffSecs from the end", Math.abs(started - 1) < 0.1, `started ${started}`);
  check("equal-power: gains stay on the unit circle", sums.length > 100 && sums.every((v) => Math.abs(v - 1) < 1e-3), `n=${sums.length}`);
  check("blend lasts handoffSecs and ends with a handoff", Math.abs(ended - 3) < 0.15, `ended ${ended}`);
  check("finished deck is emptied and out of the chain", e.decks[0].L === null && e.decks[0].ticket === null && !e.decks[0].playing);
  check("incoming deck is the head, full level, playing", e.chainOrder().join() === "1" && e.decks[1].playing && e.decks[1].blendGain === 1);
  check("incoming deck started at the top and is now the lone looper", e.decks[1].loop);
}
console.log("blend events");
{
  const e = rig("blend", 2);
  load(e, 0, 4, 1); load(e, 1, 4, 2); e.setDeck(0, "playing", true);
  const seen = [];
  run(e, 5, (en) => en.events.splice(0).forEach((x) => seen.push(x)));
  check("events: blend then handoff, deck numbers right", kinds(e, seen) === "blend,handoff" && seen[1].from === 0 && seen[1].to === 1, JSON.stringify(seen));
}

console.log("cut hand-off");
{
  const e = rig("cut", 4);
  load(e, 0, 2, 1); load(e, 1, 2, 2); e.setDeck(0, "playing", true);
  e.decks[0].pos = 2 * SR - 300;
  const seen = [];
  run(e, 0.2, (en) => en.events.splice(0).forEach((x) => seen.push(x)));
  check("cut: no blend, handoff the moment the head ends", kinds(e, seen) === "handoff", JSON.stringify(seen));
  check("cut: next deck plays from the top", e.decks[1].playing && e.decks[1].pos < 0.2 * SR + 1 && e.decks[0].L === null);
}

console.log("skip / remove / paused head");
{
  const e = rig("blend", 3);
  load(e, 0, 30, 1); load(e, 1, 30, 2); load(e, 2, 30, 3); e.setDeck(0, "playing", true);
  run(e, 0.1);
  e.skip();
  check("skip in blend mode starts a blend now", e.blend && e.blend.from === 0 && e.blend.to === 1);
  e.skip();
  check("skip during a blend completes it", !e.blend && e.chainOrder().join() === "1,2" && e.decks[1].playing);
  e.setDeck(1, "playing", false);
  e.skip();
  check("skip with a paused head cuts, doesn't fade nothing", !e.blend && e.chainOrder().join() === "2" && e.decks[2].playing);
}
{
  const e = rig("blend", 3);
  load(e, 0, 30, 1); load(e, 1, 30, 2); e.setDeck(0, "playing", true);
  e.skip(); run(e, 0.5);
  e.clearDeck(1);
  run(e, 0.05);
  check("removing the incoming deck mid-blend cancels it, head back at full", e.blend === null && e.decks[0].blendGain === 1 && e.decks[0].playing);
}
{
  const e = rig("blend", 2);
  load(e, 0, 6, 1); load(e, 1, 6, 2); // head paused
  e.decks[0].pos = 5 * SR;
  run(e, 1);
  check("a paused head never hands off", e.chainOrder().join() === "0,1" && !e.blend);
}

console.log("master sampling");
{
  const e = rig();
  load(e, 0, 4, 1); e.setDeck(0, "bpm", 120); e.setDeck(0, "playing", true);
  check("nothing to sample before audio has rendered", e.captureMaster(0, 1) === 0);
  run(e, 2);
  const frames = e.capturePad(7, -1, 1);
  const want = Math.floor(dsp.capture_frames(1, 120, SR));
  check("capturePad(-1) grabs one beat at the head's tempo", frames === want, `${frames} vs ${want}`);
  const pad = e.pads[7];
  let peak = 0; for (const v of pad.L) peak = Math.max(peak, Math.abs(v));
  check("the sampled master audio is real signal", peak > 0.05 && /master/.test(pad.name), `peak ${peak}`);
}

console.log(`\nhandoff_test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
