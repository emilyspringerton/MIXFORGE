// engine.mjs -- the MIXFORGE audio host: 4 decks, a 4-channel DJ mixer and a 16-pad MIDI
// sampler, rendering into two Float32Arrays per block.
//
// Division of labour (deliberate): every DSP DECISION -- fader taper, equal-power pan, mute/solo,
// crossfader assign, DJ filter, soft clip, tempo, MIDI byte meaning, pad map, pitch ratios,
// velocity curve, ADSR, beat-synced capture length -- is a call into dsp.wasm, compiled from
// PARENA/stdlib/mixforge/{mixer,sampler}.prn. This file only owns what PARENA's scalar-only
// WASM target cannot express yet: sample buffers, the per-deck/per-voice state structs, and the
// loop over frames. Plain ES module with no DOM/Node dependencies, so the same code runs inside
// the browser AudioWorklet (dsp-worklet.js) and headless in Node (dsp_test.mjs, render_demo.mjs).

export const DECKS = 4;
export const PADS = 16;
export const VOICES = 16;
export const ASSIGN_A = 0, ASSIGN_THRU = 1, ASSIGN_B = 2;

// Instantiate dsp.wasm synchronously (works in an AudioWorklet, where top-level await/fetch
// is not available) and return its exports.
export function instantiateDsp(bytes) {
  const mod = new WebAssembly.Module(bytes);
  return new WebAssembly.Instance(mod, {}).exports;
}

function makeDeck() {
  return {
    L: null, R: null, len: 0, srcRate: 48000, name: "",
    pos: 0, playing: false, loop: true,
    pitch: 0, range: 0.08, bpm: 0,
    trim: 1, fader: 0.8, pan: 0, filter: 0,
    mute: false, solo: false, assign: ASSIGN_THRU,
    lpL: 0, lpR: 0, peak: 0,
  };
}

function makePad() {
  return {
    L: null, R: null, len: 0, srcRate: 48000, name: "",
    root: 60, gain: 1,
    attack: 0.002, decay: 0.05, sustain: 1, release: 0.08,
    oneShot: true, // a one-shot plays to its end even after note-off (drums); else gated
  };
}

function makeVoice() {
  return { active: false, pad: 0, note: 0, pos: 0, rate: 1, gain: 0, t: 0, rt: -1, relFrom: 0 };
}

export class MixEngine {
  constructor(dsp, sampleRate) {
    this.dsp = dsp;
    this.sampleRate = sampleRate;
    this.decks = Array.from({ length: DECKS }, makeDeck);
    this.pads = Array.from({ length: PADS }, makePad);
    this.voices = Array.from({ length: VOICES }, makeVoice);
    this.crossfader = 0.5;
    this.master = 0.8;
    this.padBase = dsp.default_pad_base();
    this.chromaticPad = -1; // pad played chromatically by notes outside the pad bank; -1 = off
    this.bend = 0; // centred 14-bit pitch bend, applied to sampler voices
    this.samplerGain = 0.9;
    this.masterPeakL = 0;
    this.masterPeakR = 0;
    this.midiLog = [];
    this.nextVoice = 0;
  }

  loadDeck(i, L, R, srcRate, name = "") {
    const d = this.decks[i];
    d.L = L; d.R = R || L; d.len = L.length; d.srcRate = srcRate; d.name = name;
    d.pos = 0; d.lpL = 0; d.lpR = 0;
  }

  loadPad(j, L, R, srcRate, opts = {}) {
    const p = this.pads[j];
    p.L = L; p.R = R || L; p.len = L.length; p.srcRate = srcRate;
    Object.assign(p, opts);
  }

  setDeck(i, key, value) { this.decks[i][key] = value; }
  setPad(j, key, value) { this.pads[j][key] = value; }

  // capturePad -- beat-synced MIDI sampling off a deck: grab `beats` beats starting at the deck's
  // playhead into pad j (length from sampler.prn's capture-frames). Returns the frame count.
  capturePad(j, deckIndex, beats) {
    const d = this.decks[deckIndex];
    if (!d.L || d.len === 0) return 0;
    const frames = Math.min(
      Math.floor(this.dsp.capture_frames(beats, d.bpm, d.srcRate)),
      d.len,
    );
    const L = new Float32Array(frames);
    const R = new Float32Array(frames);
    let src = Math.floor(d.pos);
    for (let k = 0; k < frames; k++) {
      if (src >= d.len) src = d.loop ? 0 : d.len - 1;
      L[k] = d.L[src]; R[k] = d.R[src];
      src++;
    }
    this.loadPad(j, L, R, d.srcRate, {
      name: `${d.name || "deck " + (deckIndex + 1)} x${beats}`,
      root: 60, oneShot: true, attack: 0.002, decay: 0, sustain: 1, release: 0.02,
    });
    return frames;
  }

  // midi -- one MIDI channel-voice message as raw bytes (exactly what Web MIDI delivers).
  midi(status, d1 = 0, d2 = 0) {
    const x = this.dsp;
    if (x.is_note_on(status, d2)) {
      const pad = x.pad_for_note(d1, this.padBase);
      if (pad >= 0) this.trigger(pad, d1, 1, d2);
      else if (this.chromaticPad >= 0) {
        this.trigger(this.chromaticPad, d1, x.note_rate(d1, this.pads[this.chromaticPad].root), d2);
      }
      return { kind: "note-on", note: d1, velocity: d2, pad };
    }
    if (x.is_note_off(status, d2)) {
      for (const v of this.voices) {
        if (v.active && v.note === d1 && v.rt < 0 && !this.pads[v.pad].oneShot) this.releaseVoice(v);
      }
      return { kind: "note-off", note: d1 };
    }
    if (x.is_control_change(status)) {
      const deck = x.midi_channel(status) & 3;
      const param = x.cc_mixer_param(d1);
      const d = this.decks[deck];
      switch (param) {
        case 0: d.fader = x.cc_unit(d2); break;
        case 1: d.pan = x.cc_bipolar(d2); break;
        case 2: d.filter = x.cc_bipolar(d2); break;
        case 3: this.crossfader = x.cc_unit(d2); break;
        case 4: d.pitch = x.cc_bipolar(d2); break;
        case 5: d.trim = 2 * x.cc_unit(d2); break;
      }
      return { kind: "cc", deck, cc: d1, param, value: d2 };
    }
    if (x.is_pitch_bend(status)) {
      this.bend = x.pitch_bend_value(d1, d2);
      return { kind: "bend", value: this.bend };
    }
    return { kind: "ignored", kindNibble: x.midi_kind(status) };
  }

  trigger(pad, note, rate, velocity) {
    const p = this.pads[pad];
    if (!p.L || p.len === 0) return null;
    // Voice allocation: first free slot, else steal round-robin.
    let v = this.voices.find((vv) => !vv.active);
    if (!v) { v = this.voices[this.nextVoice]; this.nextVoice = (this.nextVoice + 1) % VOICES; }
    v.active = true; v.pad = pad; v.note = note; v.pos = 0; v.rate = rate;
    v.gain = this.dsp.velocity_gain(velocity) * p.gain;
    v.t = 0; v.rt = -1; v.relFrom = 0;
    return v;
  }

  releaseVoice(v) {
    const p = this.pads[v.pad];
    v.relFrom = this.dsp.env_held(v.t, p.attack, p.decay, p.sustain);
    v.rt = 0;
  }

  // process -- render n frames into outL/outR (Float32Array). The per-block parameters (gains,
  // pans, rates) are resolved once per block; filters, interpolation, envelopes and the summing
  // bus run per sample, all in dsp.wasm.
  process(outL, outR, n) {
    const x = this.dsp;
    const decks = this.decks;
    const anySolo = decks.some((d) => d.solo);
    const gainL = [0, 0, 0, 0], gainR = [0, 0, 0, 0], step = [0, 0, 0, 0];
    for (let i = 0; i < DECKS; i++) {
      const d = decks[i];
      const g = x.channel_gain(d.trim, d.fader, d.mute, d.solo, anySolo, d.assign, this.crossfader);
      gainL[i] = g * x.pan_left(d.pan);
      gainR[i] = g * x.pan_right(d.pan);
      step[i] = (d.srcRate / this.sampleRate) * x.tempo_rate(d.pitch, d.range);
    }
    const bendRate = x.bend_rate(this.bend);
    const sr = this.sampleRate;
    const chL = [0, 0, 0, 0], chR = [0, 0, 0, 0];
    const peaks = [0, 0, 0, 0];
    let mpL = 0, mpR = 0;

    for (let k = 0; k < n; k++) {
      for (let i = 0; i < DECKS; i++) {
        const d = decks[i];
        if (!d.playing || !d.L) { chL[i] = 0; chR[i] = 0; continue; }
        const i0 = Math.floor(d.pos);
        let i1 = i0 + 1;
        if (i1 >= d.len) i1 = d.loop ? 0 : d.len - 1;
        const frac = d.pos - i0;
        const sL = x.lerp_sample(d.L[i0], d.L[i1], frac);
        const sR = x.lerp_sample(d.R[i0], d.R[i1], frac);
        d.lpL = x.filter_lp_next(sL, d.lpL, d.filter);
        d.lpR = x.filter_lp_next(sR, d.lpR, d.filter);
        chL[i] = x.filter_output(sL, d.lpL, d.filter) * gainL[i];
        chR[i] = x.filter_output(sR, d.lpR, d.filter) * gainR[i];
        const a = Math.max(Math.abs(chL[i]), Math.abs(chR[i]));
        if (a > peaks[i]) peaks[i] = a;
        d.pos += step[i];
        if (d.pos >= d.len) {
          if (d.loop) d.pos -= d.len; else { d.pos = d.len - 1; d.playing = false; }
        }
      }

      // Sampler voices sum onto their own bus, which rides the THRU path (not the crossfader).
      let vL = 0, vR = 0;
      for (const v of this.voices) {
        if (!v.active) continue;
        const p = this.pads[v.pad];
        const env = v.rt < 0
          ? x.env_held(v.t, p.attack, p.decay, p.sustain)
          : x.env_release(v.rt, p.release, v.relFrom);
        const i0 = Math.floor(v.pos);
        const i1 = i0 + 1 < p.len ? i0 + 1 : i0;
        const frac = v.pos - i0;
        const g = env * v.gain;
        vL += x.lerp_sample(p.L[i0], p.L[i1], frac) * g;
        vR += x.lerp_sample(p.R[i0], p.R[i1], frac) * g;
        v.pos += v.rate * bendRate * (p.srcRate / sr);
        v.t += 1 / sr;
        if (v.rt >= 0) v.rt += 1 / sr;
        if (v.pos >= p.len - 1 || (v.rt >= 0 && v.rt >= p.release)) v.active = false;
      }
      vL *= this.samplerGain; vR *= this.samplerGain;

      const oL = x.mix4(chL[0] + vL, chL[1], chL[2], chL[3], this.master);
      const oR = x.mix4(chR[0] + vR, chR[1], chR[2], chR[3], this.master);
      outL[k] = oL; outR[k] = oR;
      const aL = Math.abs(oL), aR = Math.abs(oR);
      if (aL > mpL) mpL = aL;
      if (aR > mpR) mpR = aR;
    }

    const fall = n / sr * 1.5; // ~1.5 full-scale per second
    for (let i = 0; i < DECKS; i++) decks[i].peak = x.level_meter_decay(decks[i].peak, peaks[i], fall);
    this.masterPeakL = x.level_meter_decay(this.masterPeakL, mpL, fall);
    this.masterPeakR = x.level_meter_decay(this.masterPeakR, mpR, fall);
  }

  // snapshot -- small, cloneable view of engine state for the UI.
  snapshot() {
    return {
      decks: this.decks.map((d) => ({
        pos: d.pos, len: d.len, srcRate: d.srcRate, playing: d.playing, peak: d.peak,
        rate: this.dsp.tempo_rate(d.pitch, d.range),
      })),
      voices: this.voices.filter((v) => v.active).length,
      masterPeakL: this.masterPeakL, masterPeakR: this.masterPeakR,
      pads: this.pads.map((p) => ({ len: p.len, name: p.name })),
    };
  }
}
