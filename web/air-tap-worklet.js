// air-tap-worklet.js -- copies the master mix off the audio graph in 1024-frame interleaved stereo chunks for
// airstream.mjs's broadcaster. Outputs silence (it only listens), so connecting it onward never doubles the mix.
class AirTap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = new Float32Array(1024 * 2); this.n = 0; }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || inp.length === 0) return true;
    const L = inp[0], R = inp[1] || inp[0];
    for (let i = 0; i < L.length; i++) {
      this.buf[this.n++] = L[i]; this.buf[this.n++] = R[i];
      if (this.n === this.buf.length) { const out = this.buf; this.port.postMessage(out, [out.buffer]); this.buf = new Float32Array(1024 * 2); this.n = 0; }
    }
    return true;
  }
}
registerProcessor("air-tap", AirTap);
