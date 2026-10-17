// airstream.mjs -- "on air": the seated DJ streams their MASTER mix to the room and listeners hear it on a separate
// bus, so nobody's decks are overwritten. Transport is the room WebSocket's binary frames (server/room_server.mjs
// relays them verbatim); codec is Opus via WebCodecs where available, else 24 kHz 16-bit PCM.
//
// Wire frame: [kind u8][seq u32 BE][frames u32 BE][payload...]   kind 1 = opus packet (20 ms), 2 = pcm16 interleaved stereo.
// The first half of this file is pure (no browser APIs) and is covered by airstream_test.mjs; the second half is
// the browser glue, covered by airstream_browser_test.mjs in headless Chromium.

export const KIND_OPUS = 1, KIND_PCM16 = 2;
export const HEADER_BYTES = 9;
export const OPUS_RATE = 48000, PCM_RATE = 24000;
export const FRAME_MS = 20;

export function packFrame(kind, seq, frames, payload) {
  const out = new Uint8Array(HEADER_BYTES + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint8(0, kind); dv.setUint32(1, seq >>> 0); dv.setUint32(5, frames >>> 0);
  out.set(payload, HEADER_BYTES);
  return out;
}

export function unpackFrame(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length < HEADER_BYTES) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const kind = dv.getUint8(0);
  if (kind !== KIND_OPUS && kind !== KIND_PCM16) return null;
  return { kind, seq: dv.getUint32(1), frames: dv.getUint32(5), payload: u8.subarray(HEADER_BYTES) };
}

export function floatToPcm16(f32) {
  const out = new Uint8Array(f32.length * 2), dv = new DataView(out.buffer);
  for (let i = 0; i < f32.length; i++) {
    const v = Math.max(-1, Math.min(1, f32[i]));
    dv.setInt16(i * 2, Math.round(v < 0 ? v * 32768 : v * 32767), true);
  }
  return out;
}

export function pcm16ToFloat(u8) {
  const n = u8.length >> 1, out = new Float32Array(n), dv = new DataView(u8.buffer, u8.byteOffset, n * 2);
  for (let i = 0; i < n; i++) { const s = dv.getInt16(i * 2, true); out[i] = s < 0 ? s / 32768 : s / 32767; }
  return out;
}

// Streaming linear resampler for interleaved stereo; carries unconsumed input and its fractional phase between calls
// so chunk edges don't click.
export function makeResampler(inRate, outRate) {
  if (inRate === outRate) return (x) => x;
  const step = inRate / outRate;
  let tail = new Float32Array(0), pos = 0;
  return (x) => {
    const t = new Float32Array(tail.length + x.length); t.set(tail); t.set(x, tail.length);
    const n = t.length >> 1, out = [];
    while (Math.floor(pos) + 1 < n) {
      const i0 = Math.floor(pos), f = pos - i0;
      out.push(t[i0 * 2] * (1 - f) + t[i0 * 2 + 2] * f, t[i0 * 2 + 1] * (1 - f) + t[i0 * 2 + 3] * f);
      pos += step;
    }
    const k = Math.floor(pos);
    tail = t.slice(k * 2); pos -= k;
    return Float32Array.from(out);
  };
}

// Jitter-buffer scheduling: given the context clock, where the last scheduled audio ends, and a frame's duration,
// return when to start this frame. Underrun (playhead behind the clock): restart `lead` seconds ahead. Backlog
// (playhead more than `maxLead` ahead): drop the frame to catch up. Pure so it can be tested without a browser.
export function scheduleFrame(now, playhead, dur, lead = 0.25, maxLead = 0.9) {
  if (playhead < now + 0.02) return { start: now + lead, playhead: now + lead + dur, drop: false, underrun: playhead !== 0 };
  if (playhead > now + maxLead) return { start: 0, playhead, drop: true, underrun: false };
  return { start: playhead, playhead: playhead + dur, drop: false, underrun: false };
}

export function opusSupported() {
  return typeof AudioEncoder !== "undefined" && typeof AudioDecoder !== "undefined" && typeof EncodedAudioChunk !== "undefined" && typeof AudioData !== "undefined";
}

// ---- browser glue ------------------------------------------------------------------------------------------------

// startBroadcast -- tap `source` (the engine's master worklet node) and stream it to `ws`. Returns { stop, codec }.
// Tells the room which codec it will send via the go_on_air message the caller sends with the returned `info`.
export async function startBroadcast(ctx, source, ws, { preferOpus = true, onStats = () => {} } = {}) {
  await ctx.audioWorklet.addModule("air-tap-worklet.js");
  const tap = new AudioWorkletNode(ctx, "air-tap", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
  const mute = ctx.createGain(); mute.gain.value = 0;
  source.connect(tap); tap.connect(mute); mute.connect(ctx.destination); // pulled by the destination, but silent
  const useOpus = preferOpus && opusSupported();
  const rate = useOpus ? OPUS_RATE : PCM_RATE;
  const frameLen = rate * FRAME_MS / 1000;
  const resample = makeResampler(ctx.sampleRate, rate);
  let seq = 0, acc = new Float32Array(0), sentBytes = 0, sentFrames = 0, stopped = false;

  const emit = (kind, frames, payload) => {
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > 256 * 1024) return; // congested: drop rather than build latency
    const f = packFrame(kind, seq++, frames, payload);
    ws.send(f); sentBytes += f.length; sentFrames++;
  };

  let encoder = null;
  if (useOpus) {
    encoder = new AudioEncoder({
      output: (chunk) => { const b = new Uint8Array(chunk.byteLength); chunk.copyTo(b); emit(KIND_OPUS, frameLen, b); },
      error: (e) => onStats({ error: String(e && e.message || e) }),
    });
    encoder.configure({ codec: "opus", sampleRate: OPUS_RATE, numberOfChannels: 2, bitrate: 128000 });
  }

  let ts = 0;
  tap.port.onmessage = (ev) => {
    if (stopped) return;
    const r = resample(ev.data);
    const joined = new Float32Array(acc.length + r.length); joined.set(acc); joined.set(r, acc.length); acc = joined;
    while (acc.length >= frameLen * 2) {
      const frame = acc.slice(0, frameLen * 2); acc = acc.subarray(frameLen * 2);
      if (encoder) {
        encoder.encode(new AudioData({ format: "f32", sampleRate: OPUS_RATE, numberOfFrames: frameLen, numberOfChannels: 2, timestamp: ts, data: frame }));
        ts += FRAME_MS * 1000;
      } else emit(KIND_PCM16, frameLen, floatToPcm16(frame));
    }
  };
  const statsTimer = setInterval(() => onStats({ kbps: Math.round(sentBytes * 8 / 1000), frames: sentFrames }), 1000);
  const statsReset = setInterval(() => { sentBytes = 0; }, 1000);

  return {
    codec: useOpus ? "opus" : "pcm16", sampleRate: rate, channels: 2,
    stop() {
      stopped = true; clearInterval(statsTimer); clearInterval(statsReset);
      try { tap.port.onmessage = null; source.disconnect(tap); tap.disconnect(); mute.disconnect(); } catch {}
      if (encoder && encoder.state !== "closed") { try { encoder.close(); } catch {} }
    },
  };
}

// createListener -- plays frames from the on-air DJ on its own gain bus into `destination`. feed(arrayBuffer) takes
// each binary WebSocket message. `info` is the onair_started message ({codec, sampleRate, channels}).
export function createListener(ctx, destination, info, { onStats = () => {} } = {}) {
  const gain = ctx.createGain(); gain.gain.value = 1; gain.connect(destination);
  let playhead = 0, dropped = 0, underruns = 0, played = 0, lastSeq = -1, closed = false, peak = 0;

  const play = (L, R, rate) => {
    const dur = L.length / rate;
    const s = scheduleFrame(ctx.currentTime, playhead, dur);
    if (s.drop) { dropped++; return; }
    if (s.underrun) underruns++;
    playhead = s.playhead;
    const buf = ctx.createBuffer(2, L.length, rate);
    buf.copyToChannel(L, 0); buf.copyToChannel(R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(gain); src.start(s.start);
    played++;
    let pk = 0; for (let i = 0; i < L.length; i++) pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
    peak = pk;
    if (played % 50 === 0) onStats({ played, dropped, underruns });
  };

  let decoder = null;
  if (info.codec === "opus") {
    if (!opusSupported()) throw new Error("this browser has no WebCodecs Opus decoder");
    decoder = new AudioDecoder({
      output: (ad) => {
        const n = ad.numberOfFrames, L = new Float32Array(n), R = new Float32Array(n);
        ad.copyTo(L, { planeIndex: 0, format: "f32-planar" });
        ad.copyTo(R, { planeIndex: ad.numberOfChannels > 1 ? 1 : 0, format: "f32-planar" });
        const rate = ad.sampleRate; ad.close(); play(L, R, rate);
      },
      error: (e) => onStats({ error: String(e && e.message || e) }),
    });
    decoder.configure({ codec: "opus", sampleRate: info.sampleRate || OPUS_RATE, numberOfChannels: 2 });
  }

  return {
    gain,
    stats: () => ({ played, dropped, underruns, peak, lastSeq }),
    feed(data) {
      if (closed) return;
      const f = unpackFrame(data);
      if (!f) return;
      if (f.seq <= lastSeq && lastSeq - f.seq < 1000) return; // stale / duplicate
      lastSeq = f.seq;
      if (f.kind === KIND_OPUS) {
        if (decoder && decoder.state === "configured") decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: f.seq * FRAME_MS * 1000, data: f.payload }));
      } else {
        const x = pcm16ToFloat(f.payload), n = x.length >> 1, L = new Float32Array(n), R = new Float32Array(n);
        for (let i = 0; i < n; i++) { L[i] = x[i * 2]; R[i] = x[i * 2 + 1]; }
        play(L, R, info.sampleRate || PCM_RATE);
      }
    },
    close() { closed = true; try { gain.disconnect(); } catch {} if (decoder && decoder.state !== "closed") { try { decoder.close(); } catch {} } },
  };
}
