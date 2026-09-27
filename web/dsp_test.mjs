// dsp_test.mjs -- verifies web/dsp.wasm (PARENA/stdlib/mixforge/{mixer,sampler}.prn compiled to
// WebAssembly) two ways:
//   1. kernel checks: each exported PARENA function against a JS reference (Math.cos, 2**x, ...);
//   2. rendered-audio checks: the real MixEngine renders real frames, and a Goertzel detector
//      measures which frequencies are actually present in the output -- mute, solo, crossfader,
//      pan, filter, MIDI pads, chromatic pitch, pitch bend, CC control and beat-synced capture are
//      all asserted on the audio itself, not on internal flags.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MixEngine, instantiateDsp, ASSIGN_A, ASSIGN_B, ASSIGN_THRU } from "./engine.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const x = instantiateDsp(readFileSync(path.join(here, "dsp.wasm")));

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
const near = (a, b, eps) => Math.abs(a - b) <= eps;

console.log("kernels (mixer.prn)");
let maxErr = 0;
for (let i = 0; i <= 1000; i++) {
  const t = i / 1000;
  maxErr = Math.max(maxErr, Math.abs(x.quarter_cos(t) - Math.cos((Math.PI * t) / 2)));
}
check("quarter_cos within 3e-5 of cos(pi x/2) on [0,1]", maxErr < 3e-5, `max err ${maxErr}`);
check("pan centre is equal power", near(x.pan_left(0), Math.SQRT1_2, 3e-5) && near(x.pan_right(0), Math.SQRT1_2, 3e-5));
check("hard left / hard right", near(x.pan_left(-1), 1, 1e-9) && near(x.pan_right(-1), 0, 3e-5) && near(x.pan_right(1), 1, 1e-9));
let powErr = 0;
for (let i = -10; i <= 10; i++) { const p = i / 10; powErr = Math.max(powErr, Math.abs(x.pan_left(p) ** 2 + x.pan_right(p) ** 2 - 1)); }
check("pan preserves power across the sweep", powErr < 1e-4, `err ${powErr}`);
check("fader taper: 0.5 -> 0.125, 1 -> 1, clamped", x.fader_gain(0.5) === 0.125 && x.fader_gain(1) === 1 && x.fader_gain(2) === 1 && x.fader_gain(-1) === 0);
check("mute beats solo", x.channel_audible(1, 1, 1) === 0);
check("solo isolates", x.channel_audible(0, 0, 1) === 0 && x.channel_audible(0, 1, 1) === 1 && x.channel_audible(0, 0, 0) === 1);
check("crossfader A side: full at 0, silent at 1", near(x.xfade_gain(ASSIGN_A, 0), 1, 1e-9) && near(x.xfade_gain(ASSIGN_A, 1), 0, 3e-5));
check("crossfader B side mirrors A", near(x.xfade_gain(ASSIGN_B, 0), 0, 3e-5) && near(x.xfade_gain(ASSIGN_B, 1), 1, 1e-9));
check("crossfader THRU ignores position", x.xfade_gain(ASSIGN_THRU, 0) === 1 && x.xfade_gain(ASSIGN_THRU, 1) === 1);
check("channel_gain composes trim*taper*xfade", near(x.channel_gain(2, 1, 0, 0, 0, ASSIGN_THRU, 0.5), 2, 1e-12) && x.channel_gain(1, 1, 1, 0, 0, ASSIGN_THRU, 0.5) === 0);
check("soft_clip: 0 -> 0, odd, saturates at +-1", x.soft_clip(0) === 0 && x.soft_clip(-0.5) === -x.soft_clip(0.5) && x.soft_clip(3) === 1 && x.soft_clip(10) === 1 && x.soft_clip(-10) === -1);
check("soft_clip ~linear for small signals", near(x.soft_clip(0.05), Math.tanh(0.05), 1e-4));
check("tempo_rate +-8%", near(x.tempo_rate(1, 0.08), 1.08, 1e-12) && near(x.tempo_rate(-1, 0.08), 0.92, 1e-12) && near(x.tempo_rate(5, 0.08), 1.08, 1e-12));
check("beatmatch_rate 120 -> 126", near(x.beatmatch_rate(120, 126), 1.05, 1e-12) && x.beatmatch_rate(0, 126) === 1);

console.log("kernels (sampler.prn)");
check("midi_kind/channel decode 0x93", x.midi_kind(0x93) === 9 && x.midi_channel(0x93) === 3);
check("note-on vs velocity-0 note-off", x.is_note_on(0x90, 100) === 1 && x.is_note_on(0x90, 0) === 0 && x.is_note_off(0x90, 0) === 1 && x.is_note_off(0x80, 64) === 1);
check("CC / pitch bend kinds", x.is_control_change(0xb2) === 1 && x.is_pitch_bend(0xe0) === 1 && x.is_control_change(0x90) === 0);
check("pitch_bend_value centre/min/max", x.pitch_bend_value(0, 64) === 0 && x.pitch_bend_value(0, 0) === -8192 && x.pitch_bend_value(127, 127) === 8191);
check("pad map 36..51 -> 0..15, else -1", x.pad_for_note(36, 36) === 0 && x.pad_for_note(51, 36) === 15 && x.pad_for_note(52, 36) === -1 && x.pad_for_note(35, 36) === -1);
check("floor_div12 handles negatives", x.floor_div12(-1) === -1 && x.floor_div12(-12) === -1 && x.floor_div12(-13) === -2 && x.floor_div12(11) === 0 && x.floor_div12(12) === 1);
let rateErr = 0;
for (let note = 0; note <= 127; note++) rateErr = Math.max(rateErr, Math.abs(x.note_rate(note, 60) / 2 ** ((note - 60) / 12) - 1));
check("note_rate exact 12-TET over all 128 notes (root 60)", rateErr < 1e-14, `rel err ${rateErr}`);
let bendCents = 0;
for (let b = -8192; b <= 8191; b += 64) {
  bendCents = Math.max(bendCents, Math.abs(1200 * Math.log2(x.bend_rate(b) / 2 ** ((b / 4096) / 12))));
}
check("bend_rate within 1 cent of 2^(s/12), +-2 semitones", bendCents < 1 && x.bend_rate(0) === 1, `max ${bendCents.toFixed(3)} cents`);
check("velocity_gain square law", x.velocity_gain(127) === 1 && x.velocity_gain(0) === 0 && near(x.velocity_gain(63.5), 0.25, 1e-12));
check("cc_unit / cc_bipolar", x.cc_unit(127) === 1 && x.cc_unit(0) === 0 && x.cc_bipolar(64) === 0 && x.cc_bipolar(0) === -1 && x.cc_bipolar(127) === 1);
check("cc map 7/10/74/8/1/2", [7, 10, 74, 8, 1, 2, 64].map((c) => x.cc_mixer_param(c)).join() === "0,1,2,3,4,5,-1");
check("ADSR held: ramp, decay, sustain", near(x.env_held(0.005, 0.01, 0.1, 0.5), 0.5, 1e-12) && near(x.env_held(0.06, 0.01, 0.1, 0.5), 0.75, 1e-12) && x.env_held(1, 0.01, 0.1, 0.5) === 0.5);
check("ADSR zero attack/decay does not divide by zero", x.env_held(0, 0, 0, 0.7) === 0.7);
check("ADSR release falls to exactly 0", near(x.env_release(0.05, 0.1, 0.8), 0.4, 1e-12) && x.env_release(0.1, 0.1, 0.8) === 0);
check("capture_frames: 1 beat @120 @48k = 24000", x.capture_frames(1, 120, 48000) === 24000 && x.capture_frames(4, 0, 48000) === 96000);

// ---------------------------------------------------------------------------------------------
console.log("rendered audio (engine + dsp.wasm)");
const SR = 48000;

function goertzel(buf, hz, start = 0, n = buf.length - start) {
  const w = (2 * Math.PI * hz) / SR, c = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let k = 0; k < n; k++) { const s0 = buf[start + k] + c * s1 - s2; s2 = s1; s1 = s0; }
  return Math.sqrt(s1 * s1 + s2 * s2 - c * s1 * s2) / (n / 2); // ~amplitude of that sinusoid
}
function sine(hz, seconds, amp = 0.3) {
  const a = new Float32Array(Math.round(seconds * SR));
  for (let k = 0; k < a.length; k++) a[k] = amp * Math.sin((2 * Math.PI * hz * k) / SR);
  return a;
}
function render(engine, seconds) {
  const n = Math.round(seconds * SR), L = new Float32Array(n), R = new Float32Array(n);
  for (let o = 0; o < n; o += 128) {
    const m = Math.min(128, n - o);
    engine.process(L.subarray(o, o + m), R.subarray(o, o + m), m);
  }
  return { L, R };
}
const TONES = [300, 500, 700, 900]; // one per deck, bins well apart
function fourDecks() {
  const e = new MixEngine(x, SR);
  TONES.forEach((hz, i) => {
    e.loadDeck(i, sine(hz, 1), null, SR, `sine ${hz}`);
    e.setDeck(i, "fader", 1);
    e.setDeck(i, "playing", true);
  });
  return e;
}
const present = (buf, hz) => goertzel(buf, hz, 4800, 38400) > 0.05;
const absent = (buf, hz) => goertzel(buf, hz, 4800, 38400) < 0.005;

{
  const e = fourDecks();
  const { L } = render(e, 1);
  check("all four decks audible in the mix", TONES.every((hz) => present(L, hz)),
    TONES.map((hz) => goertzel(L, hz, 4800, 38400).toFixed(3)).join(" "));
}
{
  const e = fourDecks();
  e.setDeck(2, "mute", true);
  const { L } = render(e, 1);
  check("mute removes deck 3 only", absent(L, 700) && present(L, 300) && present(L, 500) && present(L, 900));
}
{
  const e = fourDecks();
  e.setDeck(1, "solo", true);
  e.setDeck(3, "solo", true);
  const { L } = render(e, 1);
  check("solo 2+4 isolates them", present(L, 500) && present(L, 900) && absent(L, 300) && absent(L, 700));
}
{
  const e = fourDecks();
  e.setDeck(0, "assign", ASSIGN_A);
  e.setDeck(1, "assign", ASSIGN_B);
  e.crossfader = 0;
  const a = render(e, 1).L;
  e.crossfader = 1;
  const b = render(e, 1).L;
  check("crossfader full A kills B-assigned deck", present(a, 300) && absent(a, 500) && present(a, 700));
  check("crossfader full B kills A-assigned deck", absent(b, 300) && present(b, 500) && present(b, 900));
}
{
  const e = fourDecks();
  e.setDeck(0, "pan", -1);
  const { L, R } = render(e, 1);
  check("hard-left pan: deck 1 only in left channel", present(L, 300) && goertzel(R, 300, 4800, 38400) < 0.005);
}
{
  const e = new MixEngine(x, SR);
  const two = new Float32Array(SR);
  for (let k = 0; k < SR; k++) two[k] = 0.3 * Math.sin((2 * Math.PI * 100 * k) / SR) + 0.3 * Math.sin((2 * Math.PI * 8000 * k) / SR);
  e.loadDeck(0, two, null, SR);
  Object.assign(e.decks[0], { fader: 1, playing: true, filter: -0.8 });
  const lp = render(e, 1).L;
  e.decks[0].filter = 0.8; e.decks[0].pos = 0;
  const hp = render(e, 1).L;
  const lpRatio = goertzel(lp, 8000, 4800, 38400) / goertzel(lp, 100, 4800, 38400);
  const hpRatio = goertzel(hp, 100, 4800, 38400) / goertzel(hp, 8000, 4800, 38400);
  check("DJ filter left = low-pass (8k down >20 dB vs 100 Hz)", lpRatio < 0.1, `ratio ${lpRatio.toFixed(4)}`);
  check("DJ filter right = high-pass (100 Hz down >20 dB vs 8k)", hpRatio < 0.1, `ratio ${hpRatio.toFixed(4)}`);
}
{
  const e = fourDecks();
  e.setDeck(0, "pitch", 1); // +8%
  const { L } = render(e, 1);
  check("pitch fader +8% moves deck 1 from 300 to 324 Hz", present(L, 324) && goertzel(L, 300, 4800, 38400) < 0.02);
}
{
  const e = fourDecks();
  e.midi(0xb1, 7, 0); // CC7 = 0 on MIDI channel 1 -> deck 2 fader down
  const { L } = render(e, 1);
  check("MIDI CC7 on channel 2 pulls deck 2's fader to zero", absent(L, 500) && present(L, 300));
}

// Sampler: a pad holding one second of 440 Hz, recorded at root 69 (A4).
function samplerEngine() {
  const e = new MixEngine(x, SR);
  e.loadPad(0, sine(440, 1, 0.5), null, SR, { root: 69, oneShot: false, attack: 0.001, decay: 0, sustain: 1, release: 0.05 });
  return e;
}
{
  const e = samplerEngine();
  e.midi(0x90, 36, 127); // note 36 = pad 0 (pad bank base 36)
  const { L } = render(e, 0.5);
  check("MIDI note 36 triggers pad 1 at its own pitch", goertzel(L, 440, 2400, 19200) > 0.2);
}
{
  const e = samplerEngine();
  e.chromaticPad = 0;
  e.midi(0x90, 81, 127); // A5, an octave above the pad's root -> 880 Hz
  e.midi(0x90, 76, 127); // E5, 7 semitones above root -> 659.26 Hz
  const { L } = render(e, 0.5);
  check("chromatic play: A5 on an A4 sample sounds at 880 Hz", goertzel(L, 880, 2400, 19200) > 0.1);
  check("chromatic play: E5 sounds at 659.26 Hz (a real fifth)", goertzel(L, 659.2551, 2400, 19200) > 0.1 && goertzel(L, 440, 2400, 19200) < 0.02);
}
{
  const e = samplerEngine();
  e.midi(0x90, 36, 127);
  e.midi(0xe0, 0, 127); // bend +~2 semitones
  const { L } = render(e, 0.5);
  check("pitch bend up 2 semitones: 440 -> 493.9 Hz", goertzel(L, 493.8833, 2400, 19200) > 0.1 && goertzel(L, 440, 2400, 19200) < 0.02);
}
{
  const e = samplerEngine();
  e.midi(0x90, 36, 127);
  const held = render(e, 0.2).L;
  e.midi(0x90, 36, 0); // running-status note-off
  const after = render(e, 0.2).L;
  check("note-off (vel 0) releases the gated voice to silence", goertzel(held, 440, 0, 4800) > 0.2 && goertzel(after, 440, 4800, 4800) < 1e-6 && e.snapshot().voices === 0);
}
{
  const e = samplerEngine();
  e.midi(0x90, 36, 127);
  const loud = goertzel(render(e, 0.2).L, 440, 2400, 4800);
  const e2 = samplerEngine();
  e2.midi(0x90, 36, 64);
  const soft = goertzel(render(e2, 0.2).L, 440, 2400, 4800);
  check("velocity 64 is ~-12 dB vs 127 (square law)", near(soft / loud, (64 / 127) ** 2, 0.02), `ratio ${(soft / loud).toFixed(3)}`);
}
{
  const e = fourDecks();
  e.setDeck(3, "bpm", 120);
  e.decks[3].pos = 1000;
  const frames = e.capturePad(5, 3, 0.5); // half a beat of the 900 Hz deck into pad 6
  check("beat-synced capture: 0.5 beat @120 = 12000 frames", frames === 12000 && e.pads[5].len === 12000);
  TONES.forEach((_, i) => e.setDeck(i, "playing", false));
  e.midi(0x90, 36 + 5, 127);
  const { L } = render(e, 0.2);
  check("captured pad replays the deck audio when hit over MIDI", goertzel(L, 900, 480, 7200) > 0.1);
}
{
  const e = fourDecks();
  TONES.forEach((_, i) => e.setDeck(i, "trim", 2));
  e.master = 2;
  const { L } = render(e, 0.25);
  let peak = 0;
  for (const s of L) peak = Math.max(peak, Math.abs(s));
  check("hot 4-deck sum is soft-clipped, never exceeds full scale", peak <= 1 && peak > 0.9, `peak ${peak}`);
}

console.log(`\ndsp_test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
