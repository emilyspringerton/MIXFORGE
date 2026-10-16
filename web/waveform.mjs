// Pure canvas waveform rendering, shared by any page that shows a deck's peak overview + playhead.
// renderWaveform draws a one-time min/max peak overview to an offscreen canvas (cheap to cache);
// paintWaveform composites that cached image plus a playhead overlay onto the visible canvas, so
// the ~30Hz playhead update never re-walks the sample data.

export function renderWaveform(canvas, L) {
  const w = canvas.width, h = canvas.height;
  const off = document.createElement("canvas");
  off.width = w; off.height = h;
  const octx = off.getContext("2d");
  octx.fillStyle = "#0f0f1a"; octx.fillRect(0, 0, w, h);
  const step = Math.max(1, Math.floor(L.length / w));
  octx.strokeStyle = "#5fd3ff";
  octx.beginPath();
  for (let x = 0; x < w; x++) {
    const start = x * step;
    let min = 1, max = -1;
    for (let k = 0; k < step && start + k < L.length; k++) {
      const v = L[start + k];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const y0 = h / 2 - max * (h / 2 - 1);
    const y1 = h / 2 - min * (h / 2 - 1);
    octx.moveTo(x + 0.5, y0);
    octx.lineTo(x + 0.5, y1);
  }
  octx.stroke();
  return off;
}

export function paintWaveform(canvas, waveImage, frac) {
  const cctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  cctx.clearRect(0, 0, w, h);
  if (waveImage) cctx.drawImage(waveImage, 0, 0);
  else { cctx.fillStyle = "#0f0f1a"; cctx.fillRect(0, 0, w, h); }
  const x = Math.max(0, Math.min(w, frac * w));
  cctx.fillStyle = "rgba(255,95,162,0.18)";
  cctx.fillRect(0, 0, x, h);
  cctx.strokeStyle = "#ff5fa2";
  cctx.beginPath(); cctx.moveTo(x, 0); cctx.lineTo(x, h); cctx.stroke();
}

// ---- bar-style overview (the single-player deck cards) ------------------------------------------
// peaksOf -- n peak values in 0..1 across the whole track, computed once per load. Each bar is the
// max |sample| in its slice, lightly shaped so quiet passages still read as a bar, not a dot.
export function peaksOf(L, n = 96) {
  const out = new Float32Array(n);
  const step = Math.max(1, Math.floor(L.length / n));
  let top = 1e-6;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const a = i * step, b = Math.min(L.length, a + step);
    for (let k = a; k < b; k++) { const v = Math.abs(L[k]); if (v > m) m = v; }
    out[i] = m;
    if (m > top) top = m;
  }
  for (let i = 0; i < n; i++) out[i] = Math.max(0.12, Math.pow(out[i] / top, 0.8));
  return out;
}

// drawBars -- rounded vertical bars, the played part in `played`, the rest in `rest`. `frac` is the
// playhead position 0..1 (omit/null for a deck that is waiting: all `rest`). Sized in CSS pixels and
// scaled by devicePixelRatio so it stays crisp.
export function drawBars(canvas, peaks, frac, theme = {}) {
  const { rest = "#3b435a", played = "#f06aa4", head = "#f4f5f9" } = theme;
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth || 240, ch = canvas.clientHeight || 40;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  }
  const c = canvas.getContext("2d");
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, cw, ch);
  if (!peaks) return;
  const n = peaks.length, slot = cw / n, bw = Math.max(1.5, Math.min(3, slot * 0.55));
  const playedBars = frac == null ? 0 : frac * n;
  c.lineCap = "round"; c.lineWidth = bw;
  for (let i = 0; i < n; i++) {
    const x = (i + 0.5) * slot, h = peaks[i] * (ch / 2 - 2);
    c.strokeStyle = i + 0.5 <= playedBars ? played : rest;
    c.beginPath(); c.moveTo(x, ch / 2 - h); c.lineTo(x, ch / 2 + h); c.stroke();
  }
  if (frac != null) {
    c.fillStyle = head; c.globalAlpha = 0.9;
    c.fillRect(Math.max(0, Math.min(cw - 2, frac * cw - 1)), 0, 2, ch);
    c.globalAlpha = 1;
  }
}
