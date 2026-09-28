// Shared channel-strip component: builds one deck's DOM (waveform, transport, EQ/pan/fader,
// mute/solo/assign), wires its controls to the dsp.wasm worklet via `send`, and owns loading audio
// into it (demo loop, local file) plus tempo sync against deck 0. Pulled out of what was
// room.html's inline script so a page can host N of these without re-deriving the wiring each time.
import { makeLoop } from "./demo_content.mjs";
import { renderWaveform, paintWaveform } from "./waveform.mjs";
import { estimateBpm } from "./bpm.mjs";

function slider(label, key, min, max, step, value, fmt = (v) => (+v).toFixed(2)) {
  return `<label><span>${label}</span><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output>${fmt(value)}</output></label>`;
}

export function createDeckStrip(i, { container, send, log, getCtx, getDsp, deckState, demoList, assignDefault, roomBadge = false }) {
  const el = document.createElement("div");
  const q = (s) => el.querySelector(s);
  el.className = "strip" + (roomBadge ? " room" : "");
  el.dataset.deck = i;
  el.innerHTML = `
    <h2>Deck ${i + 1} ${roomBadge ? '<span class="badge">ROOM</span>' : ""}<small class="name">empty</small></h2>
    <div class="row">
      <select class="demo"><option value="">demo loop…</option>${demoList.map((d) => `<option>${d}</option>`).join("")}</select>
      <input type="file" class="file" accept="audio/*" style="width:6.5rem;font-size:.7rem">
    </div>
    <div class="waveWrap"><canvas class="wave" width="320" height="40"></canvas></div>
    <div class="row">
      <button class="play">Play</button><button class="cue">Cue</button>
      <label style="flex:1"><span>BPM</span><input type="number" class="bpm" min="0" max="300" step="0.1" style="width:4.3rem"></label>
      <button class="sync" title="Beatmatch to deck 1's effective tempo (beatmatch-rate in mixer.prn)">Sync</button>
    </div>
    ${slider("Pitch", "pitch", -1, 1, 0.001, 0, (v) => `${(v * 8).toFixed(1)}%`)}
    ${slider("Trim", "trim", 0, 2, 0.01, 1)}
    ${slider("Filter", "filter", -1, 1, 0.01, 0, (v) => (+v === 0 ? "off" : +v < 0 ? "LP" : "HP"))}
    ${slider("Pan", "pan", -1, 1, 0.01, 0)}
    <div class="fader">${slider("Fader", "fader", 0, 1, 0.005, 0.8)}</div>
    <div class="row">
      <button class="mute">Mute</button><button class="solo">Solo</button>
      <select class="assign" title="Crossfader assign"><option value="0">X-fade A</option><option value="1">Thru</option><option value="2">X-fade B</option></select>
    </div>
    <div class="meter"><div></div></div>`;
  container.appendChild(el);
  q(".assign").value = assignDefault;

  const waveCanvas = q(".wave");
  let waveImage = null;

  el.querySelectorAll("input[type=range]").forEach((r) => {
    const out = r.nextElementSibling;
    const fmtFn = { pitch: (v) => `${(v * 8).toFixed(1)}%`, filter: (v) => (+v === 0 ? "off" : +v < 0 ? "LP" : "HP") }[r.dataset.key] || ((v) => (+v).toFixed(2));
    r.addEventListener("input", () => { out.textContent = fmtFn(r.value); send({ type: "deckParam", i, key: r.dataset.key, value: +r.value }); });
    r.addEventListener("dblclick", () => { r.value = r.defaultValue; r.dispatchEvent(new Event("input")); });
  });
  q(".assign").addEventListener("change", (e) => send({ type: "deckParam", i, key: "assign", value: +e.target.value }));
  for (const k of ["mute", "solo"]) {
    const b = q("." + k);
    b.addEventListener("click", () => { b.classList.toggle("on"); send({ type: "deckParam", i, key: k, value: b.classList.contains("on") }); });
  }
  q(".play").addEventListener("click", () => setPlaying(!deckState[i].playing));
  q(".cue").addEventListener("click", () => send({ type: "seek", i, pos: 0 }));
  q(".waveWrap").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    send({ type: "seek", i, pos: Math.floor(((e.clientX - r.left) / r.width) * deckState[i].len) });
  });
  q(".bpm").addEventListener("change", (e) => { deckState[i].bpm = +e.target.value; send({ type: "deckParam", i, key: "bpm", value: +e.target.value }); });
  q(".sync").addEventListener("click", () => syncDeck());
  q(".demo").addEventListener("change", (e) => { if (e.target.value) loadDemo(e.target.value); e.target.value = ""; });
  q(".file").addEventListener("change", (e) => e.target.files[0] && loadFile(e.target.files[0]));

  function setPlaying(on) {
    deckState[i].playing = on;
    send({ type: "deckParam", i, key: "playing", value: on });
    const b = q(".play");
    b.classList.toggle("on", on);
    b.textContent = on ? "Pause" : "Play";
  }

  // syncDeck: set this deck's pitch fader so its tempo lands on deck 0's effective tempo, using
  // the PARENA beatmatch-rate kernel (main-thread instance of the same dsp.wasm).
  function syncDeck() {
    const dsp = getDsp();
    const master = deckState[0];
    const me = deckState[i];
    if (!master.bpm || !me.bpm) { log(`sync: set a BPM on deck 1 and deck ${i + 1} first`); return; }
    const pitch0 = +document.querySelector('.strip[data-deck="0"] input[data-key=pitch]').value;
    const target = master.bpm * dsp.tempo_rate(pitch0, master.range);
    const rate = dsp.beatmatch_rate(me.bpm, target);
    const pitch = Math.max(-1, Math.min(1, (rate - 1) / me.range));
    const r = q('input[data-key=pitch]');
    r.value = pitch; r.dispatchEvent(new Event("input"));
    log(`sync deck ${i + 1}: ${me.bpm} -> ${target.toFixed(2)} bpm (rate ${rate.toFixed(4)}${Math.abs(rate - 1) > me.range ? ", clamped to ±8%" : ""})`);
  }

  // runBpmEstimate: async so a long room/local track never blocks the UI thread; results are
  // always labeled an estimate, never presented as ground truth (see bpm.mjs's own header).
  function runBpmEstimate(L, rate) {
    setTimeout(() => {
      const bpm = estimateBpm(L, rate);
      if (bpm > 0 && !deckState[i].bpm) {
        deckState[i].bpm = bpm;
        q(".bpm").value = bpm;
        send({ type: "deckParam", i, key: "bpm", value: bpm });
        log(`deck ${i + 1}: ~${bpm} BPM (estimated, autocorrelation -- not ground truth)`);
      }
    }, 0);
  }

  function setDeckAudio(L, R, rate, name, bpm) {
    deckState[i].len = L.length; deckState[i].rate = rate; deckState[i].bpm = 0;
    q(".name").textContent = name;
    q(".bpm").value = "";
    if (bpm) { deckState[i].bpm = bpm; q(".bpm").value = bpm; }
    send({ type: "deck", i, L, R, rate, name, bpm }, R && R !== L ? [L.buffer] : [L.buffer]);
    waveImage = renderWaveform(waveCanvas, L);
    paintWaveform(waveCanvas, waveImage, 0);
    if (!bpm) runBpmEstimate(L, rate);
  }

  function loadDemo(kind) {
    const ctx = getCtx();
    const loop = makeLoop(kind, 124, ctx.sampleRate, 4);
    const L = loop.L, R = new Float32Array(L);
    setDeckAudio(L, R, loop.sr, loop.name, loop.bpm);
  }

  async function loadFile(file) {
    const ctx = getCtx();
    const buf = await ctx.decodeAudioData(await file.arrayBuffer());
    const L = new Float32Array(buf.getChannelData(0));
    const R = new Float32Array(buf.numberOfChannels > 1 ? buf.getChannelData(1) : buf.getChannelData(0));
    setDeckAudio(L, R, buf.sampleRate, file.name.replace(/\.[^.]+$/, ""), 0);
    log(`deck ${i + 1}: loaded ${file.name} (${buf.duration.toFixed(1)}s)`);
  }

  function updateFromEngineState(d) {
    q(".meter > div").style.width = `${Math.min(100, d.peak * 100)}%`;
    paintWaveform(waveCanvas, waveImage, d.len ? d.pos / d.len : 0);
    if (!d.playing && deckState[i].playing) setPlaying(false);
  }

  return { el, setDeckAudio, loadDemo, loadFile, syncDeck, setPlaying, updateFromEngineState };
}
