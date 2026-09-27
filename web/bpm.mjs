// bpm.mjs -- a real, basic, honest BPM estimator: energy-envelope autocorrelation, pure JS, no
// new dependency. This is explicitly NOT the real, aubio-FFI-bound Phase 3 detector
// NORTHSTAR.md's own "real, current blockers" section already scoped (that one needs its own
// real scoping pass before it starts, per the founder's own choice this session: "basic JS
// heuristic now" over building the full aubio pipeline). Treat its output as an estimate, not a
// ground truth -- callers should label it as such (see room.html's own "~123 BPM (est.)" UI).
//
// Method: RMS energy envelope over ~23ms windows, autocorrelated across the lag range for
// 60-200 BPM, picking the lag with the strongest periodic energy pulse. Works reasonably for
// music with a clear percussive/rhythmic pulse; like any lightweight autocorrelation detector it
// can land on a half/double-tempo octave error, which is why this stays a labeled estimate.
export function estimateBpm(channelData, sampleRate) {
  const windowSize = Math.round(sampleRate * 0.023); // ~23ms, a common onset-envelope frame size
  const maxSeconds = Math.min(30, channelData.length / sampleRate); // first 30s is plenty, and fast
  const n = Math.floor((maxSeconds * sampleRate) / windowSize);
  if (n < 8) return 0; // too short a clip to say anything real

  const envelope = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const start = i * windowSize;
    let sum = 0;
    for (let k = 0; k < windowSize; k++) {
      const s = channelData[start + k] || 0;
      sum += s * s;
    }
    envelope[i] = Math.sqrt(sum / windowSize);
  }
  // Emphasize onsets (energy increases), not raw loudness -- half-wave rectified derivative,
  // the same real, standard onset-strength trick simple beat trackers use.
  const onset = new Float32Array(n);
  for (let i = 1; i < n; i++) onset[i] = Math.max(0, envelope[i] - envelope[i - 1]);

  const windowSeconds = windowSize / sampleRate;
  const minLag = Math.round(60 / 200 / windowSeconds); // 200 BPM upper bound
  const maxLag = Math.round(60 / 60 / windowSeconds);  // 60 BPM lower bound

  let bestLag = 0, bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag && lag < n; lag++) {
    let score = 0;
    for (let i = lag; i < n; i++) score += onset[i] * onset[i - lag];
    if (score > bestScore) { bestScore = score; bestLag = lag; }
  }
  if (bestLag === 0 || bestScore <= 0) return 0;
  const bpm = 60 / (bestLag * windowSeconds);
  return Math.round(bpm * 10) / 10;
}
