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
const RING_SECS = 12;
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
    // ticket: a deck in the play chain carries a monotonically increasing ticket; the chain is the
    // loaded decks sorted by it (head = lowest = "now playing"). null = not in the chain, which is
    // how multiplayer.html's free-standing decks keep their old always-loop behaviour.
    ticket: null,
    blendGain: 1, // hand-off blend multiplier, driven per block by MixEngine.updateHandoff
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
    // Hand-off between chained decks: "blend" overlaps the tail of the head deck with the start of
    // the next one (equal-power, over handoffSecs); "cut" starts the next deck the moment the head ends.
    this.handoffMode = "blend";
    this.handoffSecs = 4;
    this.blend = null; // { from, to, total, elapsed } while a blend is in flight
    this.events = []; // { kind: "blend" | "handoff", from, to } drained by snapshot()
    // Rolling copy of the last RING_SECS of master output, so a pad can sample "Master".
    this.ringL = new Float32Array(Math.ceil(sampleRate * RING_SECS));
    this.ringR = new Float32Array(this.ringL.length);
    this.ringPos = 0;
    this.ringFilled = 0;
  }

  loadDeck(i, L, R, srcRate, name = "", ticket) {
    const d = this.decks[i];
    d.L = L; d.R = R || L; d.len = L.length; d.srcRate = srcRate; d.name = name;
    d.pos = 0; d.lpL = 0; d.lpR = 0; d.blendGain = 1;
    if (ticket !== undefined) d.ticket = ticket;
  }

  // clearDeck -- empty a deck and take it out of the chain (a removed or finished deck).
  clearDeck(i) {
    const d = this.decks[i];
    d.L = d.R = null; d.len = 0; d.name = ""; d.pos = 0;
    d.playing = false; d.ticket = null; d.blendGain = 1; d.peak = 0;
  }

  // chainOrder -- engine deck indices in play order, head ("now playing") first.
  chainOrder() {
    const out = [];
    for (let i = 0; i < DECKS; i++) if (this.decks[i].ticket !== null && this.decks[i].L) out.push(i);
    return out.sort((a, b) => this.decks[a].ticket - this.decks[b].ticket);
  }

  startPlay(i) {
    const d = this.decks[i];
    if (!d.playing) { d.pos = 0; d.playing = true; }
  }

  startBlend(from, to, secs) {
    this.blend = { from, to, total: Math.max(1, Math.round(secs * this.sampleRate)), elapsed: 0 };
    // Set the t=0 gains now: updateHandoff only ramps from the next block, and the incoming deck
    // would otherwise play one block at full level (an audible click on the way in).
    this.decks[from].blendGain = this.dsp.quarter_cos(0);
    this.decks[to].blendGain = this.dsp.quarter_cos(1);
    this.startPlay(to);
    this.events.push({ kind: "blend", from, to, secs });
  }

  // finishHandoff -- the outgoing deck is done: it empties (the UI removes it), the incoming deck
  // becomes the head at full level.
  finishHandoff(from, to) {
    this.clearDeck(from);
    const t = this.decks[to];
    t.blendGain = 1;
    this.startPlay(to);
    this.blend = null;
    this.events.push({ kind: "handoff", from, to });
  }

  // skip -- hand off to the next deck now, in the current style.
  skip() {
    const chain = this.chainOrder();
    if (this.blend) { this.finishHandoff(this.blend.from, this.blend.to); return; }
    if (chain.length < 2) return;
    const head = this.decks[chain[0]];
    if (this.handoffMode === "blend" && head.playing) {
      const remain = (head.len - head.pos) / (head.srcRate * this.dsp.tempo_rate(head.pitch, head.range));
      this.startBlend(chain[0], chain[1], Math.min(this.handoffSecs, Math.max(remain, 0.05)));
    } else this.finishHandoff(chain[0], chain[1]);
  }

  // onTrackEnd -- a chained, non-looping deck ran off its end (called from the sample loop).
  onTrackEnd(i) {
    const chain = this.chainOrder();
    if (this.blend && this.blend.from === i) { this.finishHandoff(i, this.blend.to); return; }
    if (chain[0] === i && chain.length > 1 && !this.blend) this.finishHandoff(i, chain[1]);
  }

  // updateHandoff -- once per block: keep the chain's loop flags right, advance an in-flight blend,
  // and start one when the head is within handoffSecs of its end. Gains are equal-power, from the
  // PARENA quarter-cos kernel (the same curve the crossfader uses).
  updateHandoff(n) {
    const x = this.dsp;
    const chain = this.chainOrder();
    for (const i of chain) this.decks[i].loop = chain.length === 1;
    if (this.blend) {
      const b = this.blend;
      if (!chain.includes(b.from) || !chain.includes(b.to)) {
        for (const i of [b.from, b.to]) this.decks[i].blendGain = 1;
        this.blend = null; // one side was removed mid-blend: the survivor goes back to full level
      } else if (b.elapsed >= b.total) {
        this.finishHandoff(b.from, b.to);
      } else {
        const t = b.elapsed / b.total;
        this.decks[b.from].blendGain = x.quarter_cos(t);
        this.decks[b.to].blendGain = x.quarter_cos(1 - t);
        b.elapsed += n;
      }
      return;
    }
    if (chain.length > 1 && this.handoffMode === "blend") {
      const h = this.decks[chain[0]];
      if (!h.playing) return;
      const remain = (h.len - h.pos) / (h.srcRate * x.tempo_rate(h.pitch, h.range));
      if (remain <= this.handoffSecs) this.startBlend(chain[0], chain[1], Math.max(remain, 0.05));
    }
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
    if (deckIndex < 0) return this.captureMaster(j, beats);
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

  // captureMaster -- the most recent `beats` of the master mix (the future can't be sampled), at the
  // head deck's tempo. Same return contract as capturePad.
  captureMaster(j, beats) {
    const head = this.chainOrder()[0];
    const bpm = head !== undefined ? this.decks[head].bpm : 0;
    const want = Math.floor(this.dsp.capture_frames(beats, bpm, this.sampleRate));
    const frames = Math.min(want, this.ringFilled);
    if (frames <= 0) return 0;
    const L = new Float32Array(frames), R = new Float32Array(frames);
    const size = this.ringL.length;
    let src = (this.ringPos - frames + size) % size;
    for (let k = 0; k < frames; k++) { L[k] = this.ringL[src]; R[k] = this.ringR[src]; src = (src + 1) % size; }
    this.loadPad(j, L, R, this.sampleRate, {
      name: `master x${beats}`, root: 60, oneShot: true, attack: 0.002, decay: 0, sustain: 1, release: 0.02,
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
    this.updateHandoff(n);
    const anySolo = decks.some((d) => d.solo);
    const gainL = [0, 0, 0, 0], gainR = [0, 0, 0, 0], step = [0, 0, 0, 0];
    for (let i = 0; i < DECKS; i++) {
      const d = decks[i];
      const g = x.channel_gain(d.trim, d.fader, d.mute, d.solo, anySolo, d.assign, this.crossfader);
      gainL[i] = g * d.blendGain * x.pan_left(d.pan);
      gainR[i] = g * d.blendGain * x.pan_right(d.pan);
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
          if (d.loop) d.pos -= d.len;
          else {
            d.pos = d.len - 1; d.playing = false;
            if (d.ticket !== null) this.onTrackEnd(i);
          }
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
      this.ringL[this.ringPos] = oL; this.ringR[this.ringPos] = oR;
      if (++this.ringPos === this.ringL.length) this.ringPos = 0;
      const aL = Math.abs(oL), aR = Math.abs(oR);
      if (aL > mpL) mpL = aL;
      if (aR > mpR) mpR = aR;
    }

    this.ringFilled = Math.min(this.ringL.length, this.ringFilled + n);
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
        rate: this.dsp.tempo_rate(d.pitch, d.range), ticket: d.ticket,
      })),
      order: this.chainOrder(),
      blend: this.blend ? { from: this.blend.from, to: this.blend.to, t: Math.min(1, this.blend.elapsed / this.blend.total) } : null,
      events: this.events.splice(0),
      voices: this.voices.filter((v) => v.active).length,
      masterPeakL: this.masterPeakL, masterPeakR: this.masterPeakR,
      pads: this.pads.map((p) => ({ len: p.len, name: p.name })),
    };
  }
}
