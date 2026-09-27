// render_demo.mjs -- offline mixdown: runs the real MixEngine + dsp.wasm (PARENA mixer/sampler)
// over a scripted 32-bar DJ set -- four demo decks brought in one by one, crossfader throw, DJ
// filter sweep, a pad-bank drum fill over MIDI, a beat-synced capture off deck 4 replayed from
// the pads, and a chromatic melody on the pluck pad -- and writes a 16-bit stereo WAV.
//   node web/render_demo.mjs [out.wav]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MixEngine, instantiateDsp, ASSIGN_A, ASSIGN_B, ASSIGN_THRU } from "./engine.mjs";
import { makeLoop, makeKit } from "./demo_content.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || "mixforge_demo.wav";
const SR = 44100, BPM = 124, BLOCK = 128;
const beat = (60 / BPM) * SR;
const e = new MixEngine(instantiateDsp(readFileSync(path.join(here, "dsp.wasm"))), SR);

["drums", "bass", "chords", "arp"].forEach((k, i) => {
  const l = makeLoop(k, BPM, SR, 4);
  e.loadDeck(i, l.L, null, SR, l.name);
  Object.assign(e.decks[i], { bpm: BPM, fader: 0, playing: true, assign: [ASSIGN_A, ASSIGN_B, ASSIGN_THRU, ASSIGN_THRU][i] });
});
makeKit(SR).forEach((p, j) => e.loadPad(j, p.L, null, SR, { ...p, root: p.root || 60 }));
e.chromaticPad = 4;
e.crossfader = 0.5;

// Timeline, in beats. Each action runs at the first block at/after its beat.
const ev = [];
const at = (b, fn) => ev.push([b, fn]);
const ramp = (b0, b1, fn) => { for (let b = b0; b <= b1; b += 0.25) at(b, () => fn((b - b0) / (b1 - b0))); };
ramp(0, 8, (t) => (e.decks[0].fader = 0.85 * t));                 // drums in
ramp(8, 12, (t) => (e.decks[1].fader = 0.8 * t));                 // bass in
ramp(16, 20, (t) => (e.decks[2].fader = 0.75 * t));               // chords in
ramp(24, 28, (t) => (e.decks[3].fader = 0.8 * t));                // arp in
ramp(32, 40, (t) => (e.decks[2].filter = -0.9 * t));              // close LP on chords
ramp(40, 44, (t) => (e.decks[2].filter = -0.9 * (1 - t)));        // and open it again
ramp(48, 52, (t) => (e.crossfader = 0.5 - 0.5 * t));             // throw to A (bass drops out)
ramp(56, 57, (t) => (e.crossfader = 0.5 * t));                    // snap back
for (let s = 0; s < 8; s++) at(60 + s * 0.5, () => e.midi(0x90, 36 + (s % 2 ? 1 : 0), 90 + s * 4)); // kick/snare fill
at(64, () => e.capturePad(5, 3, 2));                              // sample 2 beats of the arp
for (let s = 0; s < 8; s++) at(72 + s, () => e.midi(0x90, 41, 120)); // replay capture on pad 6
const melody = [69, 72, 76, 74, 72, 69, 67, 69];
melody.forEach((n, s) => { at(80 + s, () => e.midi(0x90, n, 100)); at(80 + s + 0.8, () => e.midi(0x80, n, 0)); });
at(84, () => e.midi(0xe0, 0, 96));                                // bend up a touch
at(86, () => e.midi(0xe0, 0, 64));
ramp(88, 96, (t) => { e.master = 0.8 * (1 - t); });              // fade out
ev.sort((a, b) => a[0] - b[0]);

const total = Math.round(beat * 96 + SR);
const L = new Float32Array(total), R = new Float32Array(total);
let next = 0;
for (let o = 0; o < total; o += BLOCK) {
  while (next < ev.length && ev[next][0] * beat <= o) ev[next++][1]();
  const n = Math.min(BLOCK, total - o);
  e.process(L.subarray(o, o + n), R.subarray(o, o + n), n);
}

const pcm = Buffer.alloc(44 + total * 4);
pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + total * 4, 4); pcm.write("WAVE", 8);
pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(2, 22);
pcm.writeUInt32LE(SR, 24); pcm.writeUInt32LE(SR * 4, 28); pcm.writeUInt16LE(4, 32); pcm.writeUInt16LE(16, 34);
pcm.write("data", 36); pcm.writeUInt32LE(total * 4, 40);
let peak = 0;
for (let k = 0; k < total; k++) {
  peak = Math.max(peak, Math.abs(L[k]), Math.abs(R[k]));
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[k])) * 32767), 44 + k * 4);
  pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[k])) * 32767), 46 + k * 4);
}
writeFileSync(out, pcm);
console.log(`render_demo: wrote ${out} (${(total / SR).toFixed(1)}s, peak ${peak.toFixed(3)})`);
