// dsp-worklet.js -- the AudioWorkletProcessor that runs MIXFORGE's MixEngine on the audio thread.
// dsp.wasm arrives as bytes in processorOptions and is instantiated synchronously here, so every
// sample the browser plays went through the PARENA-compiled mixer/sampler. The main thread talks
// to it over the port: deck/pad buffers (transferred), parameter changes, raw MIDI bytes, capture
// requests. It posts a state snapshot back ~30 times a second for meters and playheads.
import { MixEngine, instantiateDsp } from "./engine.mjs";

class MixforgeProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.engine = new MixEngine(instantiateDsp(options.processorOptions.wasm), sampleRate);
    this.frames = 0;
    this.port.onmessage = (ev) => this.onMessage(ev.data);
  }

  onMessage(m) {
    const e = this.engine;
    switch (m.type) {
      case "deck": e.loadDeck(m.i, m.L, m.R, m.rate, m.name); if (m.bpm) e.setDeck(m.i, "bpm", m.bpm); break;
      case "deckParam": e.setDeck(m.i, m.key, m.value); break;
      case "seek": e.decks[m.i].pos = m.pos; break;
      case "pad": e.loadPad(m.j, m.L, m.R, m.rate, m.opts || {}); break;
      case "global": e[m.key] = m.value; break;
      case "midi": {
        const r = e.midi(m.data[0], m.data[1] || 0, m.data[2] || 0);
        this.port.postMessage({ type: "midiEvent", event: r });
        break;
      }
      case "capture": {
        const frames = e.capturePad(m.j, m.deck, m.beats);
        this.port.postMessage({ type: "captured", j: m.j, frames });
        break;
      }
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    this.engine.process(L, R, L.length);
    this.frames += L.length;
    if (this.frames >= sampleRate / 30) {
      this.frames = 0;
      this.port.postMessage({ type: "state", state: this.engine.snapshot() });
    }
    return true;
  }
}

registerProcessor("mixforge-processor", MixforgeProcessor);
