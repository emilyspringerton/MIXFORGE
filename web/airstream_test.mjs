// airstream_test.mjs -- pure parts of airstream.mjs: frame format, PCM16, resampler, jitter scheduling.
import { packFrame, unpackFrame, floatToPcm16, pcm16ToFloat, makeResampler, scheduleFrame, KIND_OPUS, KIND_PCM16, HEADER_BYTES } from "./airstream.mjs";
let pass = 0, fail = 0;
const ok = (c, l) => { if (c) { pass++; console.log("  ok  ", l); } else { fail++; console.log("  FAIL", l); } };

const f = unpackFrame(packFrame(KIND_OPUS, 4000000000, 960, new Uint8Array([1, 2, 3])));
ok(f && f.kind === KIND_OPUS && f.seq === 4000000000 && f.frames === 960 && f.payload.length === 3 && f.payload[2] === 3, "frame round-trips (seq beyond int32)");
ok(unpackFrame(new Uint8Array(HEADER_BYTES - 1)) === null, "short frame rejected");
ok(unpackFrame(packFrame(9, 0, 0, new Uint8Array(0))) === null, "unknown kind rejected");
const sub = packFrame(KIND_PCM16, 1, 2, new Uint8Array([7, 8]));
ok(unpackFrame(new Uint8Array(sub.buffer.slice(0))).payload[1] === 8, "unpack works on a fresh buffer");

const src = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, -2, 0.25]);
const back = pcm16ToFloat(floatToPcm16(src));
ok(Math.abs(back[1] - 0.5) < 1e-4 && Math.abs(back[2] + 0.5) < 1e-4, "pcm16 round-trip keeps level");
ok(back[3] === 1 && back[4] === -1 && back[5] === 1 && back[6] === -1, "pcm16 clamps out-of-range samples");

// 440 Hz stereo sine at 44.1k -> 48k, fed in odd-sized chunks; compare to the ideal sine at the output rate.
const inR = 44100, outR = 48000, N = 44100;
const sine = new Float32Array(N * 2);
for (let i = 0; i < N; i++) { const v = Math.sin(2 * Math.PI * 440 * i / inR); sine[i * 2] = v; sine[i * 2 + 1] = -v; }
const rs = makeResampler(inR, outR);
const parts = []; for (let p = 0; p < N; ) { const c = Math.min(1000 + (p % 37), N - p); parts.push(rs(sine.subarray(p * 2, (p + c) * 2))); p += c; }
const outLen = parts.reduce((a, b) => a + b.length, 0), out = new Float32Array(outLen); { let o = 0; for (const q of parts) { out.set(q, o); o += q.length; } }
const frames = outLen / 2;
ok(Math.abs(frames - N * outR / inR) < 3, `output length ~ ratio (${frames} vs ${Math.round(N * outR / inR)})`);
let maxErr = 0; for (let i = 0; i < frames; i++) maxErr = Math.max(maxErr, Math.abs(out[i * 2] - Math.sin(2 * Math.PI * 440 * i / outR)), Math.abs(out[i * 2 + 1] + Math.sin(2 * Math.PI * 440 * i / outR)));
ok(maxErr < 0.01, `resampled sine is continuous across chunk edges (max err ${maxErr.toFixed(4)})`);
const rs2 = makeResampler(48000, 24000), d = rs2(new Float32Array(48000 * 2).fill(0.3));
ok(Math.abs(d.length / 2 - 24000) <= 1 && d.every((v) => Math.abs(v - 0.3) < 1e-6), "48k -> 24k halves the frame count");
ok(makeResampler(48000, 48000)(src) === src, "same rate is a pass-through");

let s = scheduleFrame(10, 0, 0.02);
ok(s.start === 10.25 && !s.drop && !s.underrun, "first frame starts one lead ahead");
let ph = s.playhead; s = scheduleFrame(10.02, ph, 0.02);
ok(s.start === ph && Math.abs(s.playhead - (ph + 0.02)) < 1e-9, "steady state appends to the playhead");
s = scheduleFrame(11, ph, 0.02);
ok(s.underrun && s.start === 11.25, "underrun restarts one lead ahead and is flagged");
s = scheduleFrame(10, 11.5, 0.02);
ok(s.drop && s.playhead === 11.5, "backlog beyond maxLead drops the frame");

console.log(`\nairstream_test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
