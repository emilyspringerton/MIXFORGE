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
