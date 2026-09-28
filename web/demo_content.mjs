// demo_content.mjs -- built-in, synthesized source material so the DJ game is playable the moment
// it opens, with no downloads: four tempo-locked loops (drums, bass, chords, arp -- one per deck)
// and a pad kit (kick, snare, hat, clap, a pitched pluck for chromatic play). This is CONTENT, not
// mixing: it is just audio for the PARENA mixer/sampler (engine.mjs + dsp.wasm) to play. Real
// tracks come in through the deck file loaders (e.g. the yt-dlp library under tracks/).
// Deterministic (seeded noise), so tests and renders are reproducible.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 * 2 - 1;
  };
}

const midiHz = (n) => 440 * Math.pow(2, (n - 69) / 12);

function kickInto(buf, at, sr, gain = 1) {
  const len = Math.floor(0.35 * sr);
  let ph = 0;
  for (let k = 0; k < len && at + k < buf.length; k++) {
    const t = k / sr;
    const f = 45 + 110 * Math.exp(-t * 30);
    ph += (2 * Math.PI * f) / sr;
    buf[at + k] += Math.sin(ph) * Math.exp(-t * 7) * gain;
  }
}

function noiseInto(buf, at, sr, dur, decay, gain, rand, hp = false) {
  const len = Math.floor(dur * sr);
  let prev = 0;
  for (let k = 0; k < len && at + k < buf.length; k++) {
    const w = rand();
    const s = hp ? w - prev : w;
    prev = w;
    buf[at + k] += s * Math.exp(-(k / sr) * decay) * gain;
  }
}

// classic 808-style sub kick/bass: a fast pitch drop from a punchy transient down to a long,
// held sub fundamental, with a touch of tanh saturation for the "808" warmth.
function eight0eightInto(buf, at, sr, gain = 1) {
  const dur = 1.5;
  const len = Math.floor(dur * sr);
  const f0 = 220; // starting pitch of the drop
  const f1 = 52;  // settles near G#1/A1, classic 808 fundamental
  const pitchDecay = 55; // how fast the pitch drop happens
  let ph = 0;
  for (let k = 0; k < len && at + k < buf.length; k++) {
    const t = k / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t * pitchDecay);
    ph += (2 * Math.PI * f) / sr;
    const env = Math.exp(-t * 3.2);
    const dry = Math.sin(ph) * env;
    buf[at + k] += Math.tanh(dry * 1.6) * gain;
  }
}

function toneInto(buf, at, sr, hz, dur, gain, shape = "saw") {
  const len = Math.floor(dur * sr);
  for (let k = 0; k < len && at + k < buf.length; k++) {
    const t = k / sr;
    const ph = (hz * t) % 1;
    const w = shape === "saw" ? 2 * ph - 1 : shape === "square" ? (ph < 0.5 ? 1 : -1) : Math.sin(2 * Math.PI * ph);
    const env = Math.min(1, t * 200) * Math.min(1, (dur - t) * 60);
    buf[at + k] += w * env * gain;
  }
}

// makeLoop -- one of "drums" | "bass" | "chords" | "arp", `bars` bars of 4/4 at `bpm`.
export function makeLoop(kind, bpm, sr, bars = 4) {
  const beat = (60 / bpm) * sr;
  const len = Math.round(beat * 4 * bars);
  const L = new Float32Array(len);
  const rand = rng(kind.length * 7919 + bpm);
  const sixteenth = beat / 4;
  const prog = [57, 53, 60, 55]; // Am F C G roots (MIDI)
  for (let bar = 0; bar < bars; bar++) {
    const root = prog[bar % prog.length];
    for (let s = 0; s < 16; s++) {
      const at = Math.round((bar * 16 + s) * sixteenth);
      if (kind === "drums") {
        if (s % 4 === 0) kickInto(L, at, sr, 0.9);
        if (s === 4 || s === 12) noiseInto(L, at, sr, 0.18, 22, 0.45, rand);
        if (s % 2 === 0) noiseInto(L, at, sr, 0.05, 90, s % 4 === 2 ? 0.28 : 0.14, rand, true);
      } else if (kind === "bass") {
        if (s % 4 !== 0 && s % 2 === 0) toneInto(L, at, sr, midiHz(root - 24), (sixteenth * 1.6) / sr, 0.35, "saw");
        if (s === 14) toneInto(L, at, sr, midiHz(root - 12), (sixteenth * 1.6) / sr, 0.3, "saw");
      } else if (kind === "chords") {
        if (s === 0 || s === 6 || s === 10) {
          const third = [57, 64].includes(root) ? 3 : 4;
          for (const iv of [0, third, 7, 12]) toneInto(L, at, sr, midiHz(root + iv - 12), (sixteenth * 3) / sr, 0.1, "square");
        }
      } else if (kind === "arp") {
        const third = root === 57 ? 3 : 4;
        const notes = [0, third, 7, 12];
        toneInto(L, at, sr, midiHz(root + notes[s % 4] + 12), (sixteenth * 0.9) / sr, 0.12, "sine");
      }
    }
  }
  // gentle normalisation to ~ -6 dBFS peak
  let peak = 0;
  for (let k = 0; k < len; k++) peak = Math.max(peak, Math.abs(L[k]));
  if (peak > 0) for (let k = 0; k < len; k++) L[k] *= 0.5 / peak;
  return { L, R: L, sr, bpm, name: `demo ${kind} ${bpm}` };
}

// makeKit -- one-shots for pads 0..5 (kick, snare, hat, clap, pluck, 808) + a pluck meant for
// chromatic play. Pads 6..15 start empty: they are for beat-synced captures off the decks.
export function makeKit(sr) {
  const rand = rng(1234);
  const mk = (dur) => new Float32Array(Math.floor(dur * sr));
  const kick = mk(0.4); kickInto(kick, 0, sr, 0.9);
  const snare = mk(0.25); noiseInto(snare, 0, sr, 0.25, 18, 0.5, rand); toneInto(snare, 0, sr, 190, 0.08, 0.3, "sine");
  const hat = mk(0.08); noiseInto(hat, 0, sr, 0.08, 60, 0.35, rand, true);
  const clap = mk(0.3);
  for (const off of [0, 0.011, 0.023]) noiseInto(clap, Math.floor(off * sr), sr, 0.2, 25, 0.35, rand, true);
  const pluck = mk(0.8);
  for (let k = 0; k < pluck.length; k++) {
    const t = k / sr;
    pluck[k] = (Math.sin(2 * Math.PI * 261.6256 * t) + 0.3 * Math.sin(2 * Math.PI * 523.2511 * t)) * Math.exp(-t * 5) * 0.5;
  }
  const eight0eight = mk(1.5); eight0eightInto(eight0eight, 0, sr, 0.95);
  return [
    { L: kick, name: "kick", oneShot: true },
    { L: snare, name: "snare", oneShot: true },
    { L: hat, name: "hat", oneShot: true },
    { L: clap, name: "clap", oneShot: true },
    { L: pluck, name: "pluck C4", oneShot: false, root: 60, attack: 0.003, decay: 0.3, sustain: 0.6, release: 0.25 },
    { L: eight0eight, name: "808", oneShot: true },
  ];
}
