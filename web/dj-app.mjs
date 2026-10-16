// dj-app.mjs -- the single-player page (dj.html). Queueing a song adds a deck; the playing deck
// hands off to the next one (blend or cut) and then disappears. This file is the glue:
//   deckmodel.mjs   what decks exist and in what order (pure data, tested under Node)
//   engine.mjs      the audio -- the same chain lives there too (tickets), so playback order and the
//                   hand-off happen on the audio thread, sample-accurate; this page mirrors it from
//                   the engine's `handoff` events
//   solo-client.mjs YouTube link -> audio (the one thing a browser can't do), one fetch at a time
// Everything audible is dsp.wasm (PARENA); the page owns buffers, DOM and wiring only.
import { makeLoop, makeKit } from "./demo_content.mjs";
import { DECKS, PADS } from "./engine.mjs";
import { bootEngine } from "./mixforge-engine.mjs";
import { createSampler, noteName } from "./sampler.mjs";
import { createMidiHandler } from "./midi.mjs";
import { mountRecorder } from "./recorder.mjs";
import { maybeHandlePopupReturn, consumeReturnFragment } from "./iduna.mjs";
import { peaksOf, drawBars } from "./waveform.mjs";
import { estimateBpm } from "./bpm.mjs";
import { icon } from "./icons.mjs";
import { createSoloClient, normalizeYoutubeUrl } from "./solo-client.mjs";
import * as M from "./deckmodel.mjs";

// If this exact page is the popup IDUNA's SSO login redirected back to, finish that round trip and
// stop -- don't also boot the mixer in the popup.
if (await maybeHandlePopupReturn()) throw new Error("__mixforge_popup_return__");
await consumeReturnFragment();

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---- state ------------------------------------------------------------------------------------
const m = M.createModel();
let ctx = null, dsp = null, send = () => {};
let sampler = null;
const SLIDERS = [
  { k: "pitch", label: "Pitch", min: -8, max: 8, step: 0.1, def: 0, origin: 0, fmt: (v) => (v > 0 ? "+" : "") + v.toFixed(1) + "%" },
  { k: "trim", label: "Trim", min: 0, max: 2, step: 0.01, def: 1, origin: 1, fmt: (v) => v.toFixed(2) },
  { k: "filter", label: "Filter", min: -1, max: 1, step: 0.01, def: 0, origin: 0, fmt: (v) => (Math.abs(v) < 0.03 ? "off" : (v < 0 ? "LP " : "HP ") + Math.round(Math.abs(v) * 100) + "%") },
  { k: "pan", label: "Pan", min: -1, max: 1, step: 0.01, def: 0, origin: 0, fmt: (v) => v.toFixed(2) },
  { k: "fader", label: "Fader", min: 0, max: 1, step: 0.01, def: 0.8, origin: 0, fmt: (v) => v.toFixed(2) },
];
const defaultVals = () => Object.fromEntries(SLIDERS.map((s) => [s.k, s.def]));

// per-deck page-side state, indexed by deck id (1..4); also what the sampler reads (bpm) via deckState
const ds = {};
for (let id = 1; id <= DECKS; id++) ds[id] = { vals: defaultVals(), muted: false, soloed: false, playing: false, pos: 0, len: 0, srcRate: 48000, rate: 1, bpm: 0, peaks: null, fetchMsg: "", loopKind: 0 };
const deckState = [1, 2, 3, 4].map((id) => ds[id]);
let engState = null; // last snapshot from the worklet
let blend = null; // { from, to } deck ids while a hand-off blend is in flight
const jobs = new Map(); // deck id -> { cancel, rid } for the fetch in flight / waiting

// ---- notices ----------------------------------------------------------------------------------
let noticeTimer = 0;
function notice(text, kind = "", ms = 0) {
  const el = $("#notice");
  clearTimeout(noticeTimer);
  el.className = "notice" + (kind ? " " + kind : "");
  el.innerHTML = text ? (kind === "err" ? icon("warn") : "") + `<span>${esc(text)}</span>` : "";
  if (ms) noticeTimer = setTimeout(() => notice(""), ms);
}

// ---- server link (YouTube) --------------------------------------------------------------------
const wsProto = location.protocol === "https:" ? "wss:" : "ws:";
let serverDown = false;
const solo = createSoloClient({
  wsUrl: `${wsProto}//${location.host}/ws?solo=1`,
  onStatus: (s) => {
    serverDown = s === "down";
    if (serverDown) notice("Can't reach the server, so YouTube links won't load. Files and demo loops still work.", "err");
    else if ($("#notice .err")) notice("");
    renderComposer();
  },
});

// ---- rendering: composer ----------------------------------------------------------------------
function renderComposer() {
  const full = M.isFull(m);
  const queueMode = m.mode === "queue";
  $("#modeQueue").setAttribute("aria-pressed", queueMode);
  $("#modeNow").setAttribute("aria-pressed", !queueMode);
  $("#targetWrap").hidden = queueMode;
  const target = M.targetDeck(m);
  const loaded = M.loadedOrder(m);
  $("#targets").innerHTML = M.ordered(m).map((d) =>
    `<button type="button" data-target="${d.id}" aria-pressed="${target && d.id === target.id}">Deck ${d.id}${d.id === loaded[0]?.id ? " · now" : ""}</button>`).join("");
  const go = $("#go");
  go.className = "go" + (queueMode ? "" : " now");
  go.disabled = queueMode && full;
  go.innerHTML = queueMode ? `${icon("plus", 17)} Add to queue` : `${icon("download", 17)} Load into Deck ${target ? target.id : 1}`;
  $("#hint").textContent = M.hint(m);
  $("#dots").innerHTML = Array.from({ length: M.MAX_DECKS }, (_, i) => `<i class="${i < m.decks.length ? "on" : ""}"></i>`).join("");
  $("#slotText").textContent = `${m.decks.length} of ${M.MAX_DECKS} decks in use`;
  $("#deckCount").textContent = String(m.decks.length);
  $("#addDeck").disabled = !M.canAddDeck(m);
  $("#hoCut").setAttribute("aria-pressed", m.handoff === "cut");
  $("#hoBlend").setAttribute("aria-pressed", m.handoff === "blend");
}

// ---- rendering: decks -------------------------------------------------------------------------
const grid = $("#decks");
const cards = new Map(); // id -> { el, sig }
const openSlot = document.createElement("button");
openSlot.type = "button";
openSlot.className = "openslot";
openSlot.setAttribute("aria-label", "Add an empty deck");
openSlot.dataset.act = "add-deck";

const SRC_ICON = { yt: "youtube", file: "file", loop: "loop" };

function sliderHTML(s, v) {
  const p = (v - s.min) / (s.max - s.min), o = (s.origin - s.min) / (s.max - s.min);
  return `<div class="slider"><span class="lbl">${s.label}</span>
    <input class="rng" type="range" data-k="${s.k}" aria-label="${s.label}" min="${s.min}" max="${s.max}" step="${s.step}" value="${v}" style="--a:${Math.min(p, o)};--b:${Math.max(p, o)}">
    <span class="val">${s.fmt(v)}</span></div>`;
}

// view -- one row of M.describe, adjusted for a blend in flight
function view(row) {
  const v = { ...row };
  if (blend && row.id === blend.from) { v.pos = "Fading out"; v.role = "out"; v.foot = `Blending into Deck ${blend.to}`; }
  else if (blend && row.id === blend.to) { v.pos = "Fading in"; v.role = "in"; }
  else if (row.pending) v.pos = "Fetching";
  v.now = row.isNow || v.role === "in";
  return v;
}

function cardHTML(v, d) {
  const head = `<div class="head">
    <div class="num">${d.id}</div><span class="name">Deck ${d.id}</span>
    <span class="pill ${v.role || (v.isNow ? "now" : "")}">${v.isNow && !v.role ? "<i></i>" : ""}${esc(v.pos)}</span>
    <div class="spacer"></div>
    ${v.canSkip ? `<button type="button" class="btn icon sm" data-act="skip" aria-label="Skip to next deck" title="Skip to next deck">${icon("skip")}</button>` : ""}
    ${v.canRemove ? `<button type="button" class="btn icon sm" data-act="remove" aria-label="Remove deck" title="Remove deck" style="color:var(--muted)">${icon("x")}</button>` : ""}
  </div>`;
  if (d.status === "empty") {
    return head + `<div class="drop">${icon("music", 26)}
      <div><b>Empty deck</b><small>The next song you queue lands here, or load one yourself.</small></div>
      <div class="row" style="justify-content:center;gap:8px">
        <button type="button" class="btn" data-act="load-yt">${icon("youtube")} YouTube</button>
        <button type="button" class="btn" data-act="load-file">${icon("file")} File</button>
        <button type="button" class="btn" data-act="load-loop">${icon("loop")} Demo loop</button>
      </div></div>`;
  }
  if (d.status === "fetching") {
    return head + `<div class="fetching"><div class="spin" role="progressbar" aria-label="Fetching"></div>
      <div><b>Fetching from YouTube</b><small class="fetch-msg">${esc(ds[d.id].fetchMsg || "Waiting for its turn")}</small></div></div>`;
  }
  const s = ds[d.id];
  const footIcon = v.role === "out" || (v.isNow && v.hasOthers) ? `<span class="hand">${icon("arrow")}</span>` : v.isNow ? icon("loop") : icon("clock");
  return head + `<div style="display:flex;flex-direction:column;gap:14px;flex:1">
    <div style="min-width:0"><div class="title">${esc(d.title)}</div>
      <div class="sub">${icon(SRC_ICON[d.kind] || "music", 14)}<span>${esc(d.artist)} · ${M.fmt(d.dur)}</span></div></div>
    <div><div class="wave" data-act="seek"><canvas></canvas></div>
      <div class="times"><span class="t-el">0:00</span><span class="t-rem">-${M.fmt(d.dur)}</span></div></div>
    <div class="transport">
      <button type="button" class="btn play" data-act="play"></button>
      <button type="button" class="btn icon" data-act="cue" aria-label="Cue to start" title="Cue to start">${icon("cue", 16)}</button>
      <label class="bpm"><span>BPM</span><input type="text" inputmode="decimal" aria-label="BPM" class="bpm-in" value="${s.bpm || ""}"></label>
      <button type="button" class="btn icon" data-act="sync" aria-label="Sync tempo to the playing deck" title="Sync tempo to the playing deck">${icon("sync", 16)}</button>
    </div>
    <div class="sliders">${SLIDERS.map((sl) => sliderHTML(sl, s.vals[sl.k])).join("")}</div>
    <div class="tools">
      <button type="button" class="btn sm" data-act="mute" aria-pressed="false">${icon("mute")} Mute</button>
      <button type="button" class="btn sm" data-act="solo" aria-pressed="false">${icon("solo")} Solo</button>
      <div class="group" role="group" aria-label="Replace this track">
        <button type="button" data-act="load-yt" aria-label="Load a YouTube link into this deck" title="Load a YouTube link into this deck">${icon("youtube")}</button>
        <button type="button" data-act="load-file" aria-label="Load a local file into this deck" title="Load a local file into this deck">${icon("file")}</button>
        <button type="button" data-act="load-loop" aria-label="Load a demo loop into this deck" title="Load a demo loop into this deck">${icon("loop")}</button>
      </div>
    </div>
    <div class="foot">${footIcon}<span class="foot-text">${esc(v.foot)}</span></div>
  </div>`;
}

function renderDecks() {
  const rows = M.describe(m, headRemain()).map(view);
  const els = [];
  for (const v of rows) {
    const d = M.deckById(m, v.id);
    let c = cards.get(v.id);
    if (!c) { c = { el: document.createElement("article"), sig: "" }; c.el.dataset.id = v.id; cards.set(v.id, c); }
    // structural signature only: sliders, BPM, play/mute/solo and the clock update in place so a
    // re-render never steals focus or interrupts a drag
    const sig = [d.status, v.pending, v.pos, v.role || "", v.isNow, v.canRemove, v.canSkip, v.hasOthers, d.title, d.artist, d.dur, d.kind, v.status === "loaded" ? "" : ds[v.id].fetchMsg].join("|");
    if (c.sig !== sig) {
      c.sig = sig;
      c.el.innerHTML = cardHTML(v, d);
      c.lastFrac = -1;
    }
    c.el.className = "deck" + (v.now ? " now" : "");
    c.el.setAttribute("aria-label", `Deck ${d.id}, ${v.pos.toLowerCase()}${d.status === "loaded" ? ", " + d.title : ""}`);
    els.push(c.el);
    if (d.status === "loaded") syncCard(d.id, v);
  }
  for (const id of [...cards.keys()]) if (!M.deckById(m, id)) { cards.get(id).el.remove(); cards.delete(id); }
  if (M.canAddDeck(m)) {
    const left = M.MAX_DECKS - m.decks.length;
    openSlot.innerHTML = `<span class="dot">${icon("plus", 18)}</span><b>Open slot</b><small>${left === 1 ? "One more deck fits." : left + " more decks fit."} Queue a song to fill ${left === 1 ? "it" : "one"}, or add it empty.</small>`;
    els.push(openSlot);
  }
  els.forEach((el, i) => { if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null); });
  while (grid.children.length > els.length) grid.lastChild.remove();
  renderComposer();
  refreshSamplerSources();
}

// syncCard -- the continuously-changing parts of one loaded deck, written in place
function syncCard(id, v) {
  const c = cards.get(id), s = ds[id], el = c.el;
  const play = $(".play", el);
  if (!play) return;
  const label = s.playing ? "Pause" : "Play";
  if (play.dataset.state !== label) {
    play.dataset.state = label;
    play.className = "btn play" + (s.playing ? " on" : "");
    play.setAttribute("aria-pressed", s.playing);
    play.innerHTML = `${icon(s.playing ? "pause" : "play", 14)} ${label}`;
  }
  $('[data-act="mute"]', el).setAttribute("aria-pressed", s.muted);
  $('[data-act="mute"]', el).classList.toggle("on", s.muted);
  $('[data-act="solo"]', el).setAttribute("aria-pressed", s.soloed);
  $('[data-act="solo"]', el).classList.toggle("on", s.soloed);
  const bpmIn = $(".bpm-in", el);
  if (document.activeElement !== bpmIn && bpmIn.value !== String(s.bpm || "")) bpmIn.value = s.bpm || "";
  const frac = s.len ? s.pos / s.len : 0;
  const showHead = s.playing || s.pos > 0;
  const stamp = Math.round(frac * 400) + (showHead ? "p" : "r");
  if (c.lastFrac !== stamp) {
    c.lastFrac = stamp;
    drawBars($("canvas", el), s.peaks, showHead ? frac : null);
    const secs = s.len ? s.pos / s.srcRate : 0, total = s.len ? s.len / s.srcRate : 0;
    $(".t-el", el).textContent = M.fmt(secs);
    $(".t-rem", el).textContent = "-" + M.fmt(total - secs);
  }
  const ft = $(".foot-text", el);
  if (ft && ft.textContent !== v.foot) ft.textContent = v.foot;
}

function headRemain() {
  const id = M.headId(m);
  if (!id) return 0;
  const s = ds[id];
  return s.len ? (s.len - s.pos) / (s.srcRate * s.rate) : 0;
}

// ---- engine plumbing --------------------------------------------------------------------------
const ei = (id) => id - 1; // deck id -> engine deck index
function pushParam(id, key, value) { send({ type: "deckParam", i: ei(id), key, value }); }
function pushVal(id, k, v) {
  if (k === "pitch") pushParam(id, "pitch", v / 8);
  else if (k === "filter") pushParam(id, "filter", Math.abs(v) < 0.03 ? 0 : v);
  else pushParam(id, k, v);
}
function pushAllParams(id) {
  const s = ds[id];
  for (const sl of SLIDERS) pushVal(id, sl.k, s.vals[sl.k]);
  pushParam(id, "mute", s.muted); pushParam(id, "solo", s.soloed);
  pushParam(id, "assign", 1); // THRU: the hand-off, not the crossfader, moves audio between decks
}

// install -- put decoded audio on a deck: model, engine and page state. `track` = { kind, title, artist }
function install(id, track, L, R, rate) {
  const res = M.fulfill(m, id, { ...track, dur: L.length / rate, bpm: 0 });
  if (!res) return;
  const s = ds[id];
  if (res.firstLoad) { s.vals = defaultVals(); s.muted = false; s.soloed = false; }
  s.peaks = peaksOf(L, 96);
  Object.assign(s, { len: L.length, srcRate: rate, pos: 0, bpm: 0, fetchMsg: "", playing: res.wasHead ? true : (res.firstLoad ? false : s.playing) });
  // BPM estimate on a copy of the first 30 s (the buffers are transferred to the audio thread below)
  const head = L.slice(0, Math.min(L.length, Math.round(30 * rate)));
  setTimeout(() => {
    const bpm = estimateBpm(head, rate);
    if (bpm > 0 && !s.bpm && M.deckById(m, id)?.title === track.title) { s.bpm = bpm; pushParam(id, "bpm", bpm); }
  }, 0);
  const mono = R === L || !R;
  send({ type: "deck", i: ei(id), L, R: mono ? null : R, rate, name: track.title, ticket: res.deck.ticket }, mono ? [L.buffer] : [L.buffer, R.buffer]);
  if (res.firstLoad) pushAllParams(id);
  if (res.wasHead) { send({ type: "seek", i: ei(id), pos: 0 }); pushParam(id, "playing", true); }
  renderDecks();
}

function removeDeck(id) {
  const d = M.deckById(m, id);
  if (!d || !M.remove(m, id)) return;
  const j = jobs.get(id); if (j) { j.cancel(); jobs.delete(id); }
  send({ type: "clearDeck", i: ei(id) });
  Object.assign(ds[id], { playing: false, pos: 0, len: 0, bpm: 0, peaks: null, fetchMsg: "" });
  renderDecks();
}

// ---- loading: YouTube, file, demo loop --------------------------------------------------------
async function decodeUrl(url) {
  const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  return toStereo(buf);
}
function toStereo(buf) {
  const L = new Float32Array(buf.getChannelData(0));
  const R = buf.numberOfChannels > 1 ? new Float32Array(buf.getChannelData(1)) : null;
  return { L, R, rate: buf.sampleRate };
}

async function submit() {
  const input = $("#url");
  const url = normalizeYoutubeUrl(input.value);
  if (!url) { notice(input.value.trim() ? "That doesn't look like a YouTube link. Try youtu.be/… or youtube.com/watch…" : "Paste a YouTube link first.", "err"); input.focus(); return; }
  if (serverDown) { notice("Can't reach the server, so YouTube links won't load. Files and demo loops still work.", "err"); return; }
  const plan = M.plan(m);
  if (!plan) { notice("All four decks are in use. Skip or remove one to queue more.", "err"); return; }
  const d = M.reserve(m, plan);
  const id = d.id, rid = d.rid;
  input.value = "";
  notice("");
  const stale = () => { const x = M.deckById(m, id); return !x || x.rid !== rid; };
  ds[id].fetchMsg = "Waiting for its turn";
  const job = solo.fetchTrack(url, (p) => {
    if (stale()) return;
    ds[id].fetchMsg = p.phase === "retrying" ? `Hit a snag, trying once more in ${Math.max(1, Math.round(p.retryInMs / 1000))}s` : "Downloading audio…";
    const card = cards.get(id);
    const msg = card && $(".fetch-msg", card.el);
    if (msg) msg.textContent = ds[id].fetchMsg; else renderDecks();
  });
  jobs.set(id, { cancel: job.cancel, rid });
  renderDecks();
  try {
    const got = await job.promise;
    if (stale()) return;
    ds[id].fetchMsg = "Decoding…";
    const a = await decodeUrl(got.url);
    if (stale()) return;
    install(id, { kind: "yt", title: got.title || "YouTube track", artist: got.artist || "YouTube" }, a.L, a.R, a.rate);
  } catch (err) {
    if (err.message === "cancelled" || stale()) return;
    M.fail(m, id);
    ds[id].fetchMsg = "";
    notice(friendlyError(err.message), "err");
    renderDecks();
  } finally {
    const j = jobs.get(id); if (j && j.rid === rid) jobs.delete(id);
  }
}

function friendlyError(msg) {
  if (/not a bot|sign in/i.test(msg)) return "YouTube asked the server to prove it isn't a bot, so that one wouldn't download. Try again in a bit, or load a file.";
  if (/private|unavailable|removed/i.test(msg)) return "YouTube says that video isn't available.";
  return "Couldn't load that link: " + msg;
}

// a deck's own file/loop buttons replace that deck directly, whatever the composer's mode is
function loadInto(id, track, L, R, rate) {
  const d = M.deckById(m, id);
  if (!d) return;
  d.rid = ++m.rid; // anything still fetching for this deck is now stale
  const j = jobs.get(id); if (j) { j.cancel(); jobs.delete(id); }
  install(id, track, L, R, rate);
}

let fileTarget = 0;
const fileInput = document.createElement("input");
fileInput.type = "file"; fileInput.accept = "audio/*"; fileInput.hidden = true;
document.body.appendChild(fileInput);
fileInput.addEventListener("change", async () => {
  const f = fileInput.files[0], id = fileTarget;
  fileInput.value = "";
  if (!f || !id) return;
  try {
    const a = toStereo(await ctx.decodeAudioData(await f.arrayBuffer()));
    loadInto(id, { kind: "file", title: f.name.replace(/\.[^.]+$/, ""), artist: "Local file" }, a.L, a.R, a.rate);
  } catch (err) { notice("Couldn't read that file: " + err.message, "err"); }
});

const LOOPS = ["drums", "bass", "chords", "arp"];
function loadLoop(id) {
  const s = ds[id];
  const kind = LOOPS[s.loopKind++ % LOOPS.length];
  const loop = makeLoop(kind, 124, ctx.sampleRate, 16);
  loadInto(id, { kind: "loop", title: "Demo " + kind, artist: "Built-in loop" }, loop.L, null, loop.sr);
  s.bpm = 124; pushParam(id, "bpm", 124);
}

// ---- deck + composer events -------------------------------------------------------------------
grid.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const card = btn.closest("article[data-id]");
  const id = card ? +card.dataset.id : 0;
  const act = btn.dataset.act;
  const s = ds[id];
  if (act === "add-deck") { M.addDeck(m); renderDecks(); }
  else if (act === "remove") removeDeck(id);
  else if (act === "skip") send({ type: "skip" });
  else if (act === "play") { s.playing = !s.playing; pushParam(id, "playing", s.playing); renderDecks(); }
  else if (act === "cue") { send({ type: "seek", i: ei(id), pos: 0 }); s.pos = 0; renderDecks(); }
  else if (act === "sync") syncDeck(id);
  else if (act === "mute") { s.muted = !s.muted; pushParam(id, "mute", s.muted); renderDecks(); }
  else if (act === "solo") { s.soloed = !s.soloed; pushParam(id, "solo", s.soloed); renderDecks(); }
  else if (act === "load-yt") { m.mode = "now"; m.target = id; renderComposer(); $("#url").focus(); window.scrollTo({ top: 0, behavior: "smooth" }); }
  else if (act === "load-file") { fileTarget = id; fileInput.click(); }
  else if (act === "load-loop") loadLoop(id);
  else if (act === "seek") {
    const r = btn.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    send({ type: "seek", i: ei(id), pos: Math.floor(frac * s.len) });
    s.pos = frac * s.len;
    renderDecks();
  }
});
openSlot.addEventListener("click", () => { M.addDeck(m); renderDecks(); });

grid.addEventListener("input", (e) => {
  const card = e.target.closest("article[data-id]");
  if (!card) return;
  const id = +card.dataset.id, s = ds[id];
  if (e.target.matches("input.rng")) {
    const sl = SLIDERS.find((x) => x.k === e.target.dataset.k);
    const v = +e.target.value;
    s.vals[sl.k] = v;
    rangeVars(e.target, sl.origin);
    e.target.parentElement.querySelector(".val").textContent = sl.fmt(v);
    pushVal(id, sl.k, v);
  } else if (e.target.matches(".bpm-in")) {
    const n = parseFloat(e.target.value.replace(",", "."));
    if (n > 0 && n < 400) { s.bpm = n; pushParam(id, "bpm", n); }
  }
});
grid.addEventListener("dblclick", (e) => {
  if (!e.target.matches("input.rng")) return;
  const sl = SLIDERS.find((x) => x.k === e.target.dataset.k);
  e.target.value = sl.def;
  e.target.dispatchEvent(new Event("input", { bubbles: true }));
});

function rangeVars(input, origin) {
  const min = +input.min, max = +input.max;
  const p = (+input.value - min) / (max - min), o = (origin - min) / (max - min);
  input.style.setProperty("--a", Math.min(p, o));
  input.style.setProperty("--b", Math.max(p, o));
}
for (const id of ["master", "samplerGain"]) {
  const el = document.getElementById(id);
  rangeVars(el, 0);
  el.addEventListener("input", () => rangeVars(el, 0));
}
$("#master").addEventListener("input", (e) => { $("#masterVal").textContent = (+e.target.value).toFixed(2); send({ type: "global", key: "master", value: +e.target.value }); });

// Sync: set this deck's pitch fader so its tempo lands on the playing deck's, using the PARENA
// beatmatch-rate kernel (main-thread instance of the same dsp.wasm).
function syncDeck(id) {
  const headId = M.headId(m);
  if (!headId || id === headId) { notice("Sync matches a deck to the one that's playing.", "", 3500); return; }
  const master = ds[headId], me = ds[id];
  if (!master.bpm || !me.bpm) { notice(`Set a BPM on Deck ${headId} and Deck ${id} first.`, "err", 4500); return; }
  const target = master.bpm * dsp.tempo_rate(master.vals.pitch / 8, 0.08);
  const rate = dsp.beatmatch_rate(me.bpm, target);
  const pitch = Math.max(-8, Math.min(8, ((rate - 1) / 0.08) * 8));
  me.vals.pitch = Math.round(pitch * 10) / 10;
  pushVal(id, "pitch", me.vals.pitch);
  const input = $('input[data-k="pitch"]', cards.get(id).el);
  input.value = me.vals.pitch;
  rangeVars(input, 0);
  input.parentElement.querySelector(".val").textContent = SLIDERS[0].fmt(me.vals.pitch);
  notice(`Deck ${id} synced: ${me.bpm} → ${target.toFixed(1)} BPM${Math.abs(rate - 1) > 0.08 ? " (limited to ±8%)" : ""}.`, "ok", 4000);
}

$("#modeQueue").addEventListener("click", () => { m.mode = "queue"; renderComposer(); });
$("#modeNow").addEventListener("click", () => { m.mode = "now"; renderComposer(); });
$("#targets").addEventListener("click", (e) => { const b = e.target.closest("[data-target]"); if (b) { m.target = +b.dataset.target; renderComposer(); } });
$("#addDeck").addEventListener("click", () => { M.addDeck(m); renderDecks(); });
$("#hoCut").addEventListener("click", () => setHandoff("cut"));
$("#hoBlend").addEventListener("click", () => setHandoff("blend"));
function setHandoff(mode) { m.handoff = mode; send({ type: "global", key: "handoffMode", value: mode }); renderDecks(); }
$("#go").addEventListener("click", submit);
$("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
$("#url").addEventListener("input", () => { if ($("#notice .err") && !serverDown) notice(""); });

// ---- sampler ----------------------------------------------------------------------------------
function resolveSampleSource(value) {
  if (value === "master") return -1;
  if (value === "current") { const id = M.headId(m); return id ? ei(id) : null; }
  const d = M.deckById(m, +value);
  return d && d.status === "loaded" ? ei(d.id) : null;
}
function refreshSamplerSources() {
  if (!sampler) return;
  sampler.setSources([
    { value: "current", label: "Current deck" },
    ...[1, 2, 3, 4].map((id) => { const d = M.deckById(m, id); return { value: id, label: `Deck ${id}`, disabled: !(d && d.status === "loaded") }; }),
    { value: "master", label: "Master" },
  ]);
}

// ---- boot -------------------------------------------------------------------------------------
$("#start").addEventListener("click", async () => {
  $("#start").disabled = true;
  const engine = await bootEngine({
    onState: onState,
    onCaptured: (c) => notice(c.frames ? `Sampled into pad ${c.j + 1}.` : "Nothing to sample yet.", c.frames ? "ok" : "", 3000),
    onMidiEvent: () => {},
  });
  ctx = engine.ctx; dsp = engine.dsp; send = engine.send;
  mountRecorder($("#recorder"), engine.recordStream, (line) => notice(line, "", 4000));
  for (let id = 1; id <= DECKS; id++) pushParam(id, "assign", 1);
  send({ type: "global", key: "handoffMode", value: m.handoff });
  send({ type: "global", key: "handoffSecs", value: 4 });
  makeKit(ctx.sampleRate).forEach((p, j) => {
    const L = new Float32Array(p.L);
    send({ type: "pad", j, L, R: L, rate: ctx.sampleRate, opts: { name: p.name, oneShot: p.oneShot, root: p.root || 60, attack: p.attack ?? 0.002, decay: p.decay ?? 0.05, sustain: p.sustain ?? 1, release: p.release ?? 0.08 } }, [L.buffer]);
  });
  sampler = createSampler({
    send: (msg, t) => send(msg, t), log: (line) => notice(line, "", 4000), deckState, PADS,
    sources: [{ value: "current", label: "Current deck" }], resolveDeck: resolveSampleSource,
  });
  send({ type: "global", key: "chromaticPad", value: sampler.getChromPad() });
  refreshSamplerSources();
  const midi = createMidiHandler({
    onMessage: (bytes) => send({ type: "midi", data: bytes }),
    onNoteOn: (note) => sampler.flashPad(note),
    statusEl: $("#midiStatus"), selectEl: $("#midiIn"),
  });
  midi.init();
  const exportsN = Object.keys(dsp).filter((k) => typeof dsp[k] === "function").length;
  $("#dspStatus").innerHTML = `${icon("cpu")}<span>dsp.wasm · ${exportsN} exports · ${Math.round(ctx.sampleRate / 1000)} kHz</span>`;
  $("#overlay").remove();
  window.__mixforge = { model: m, ds }; // handle for the headless smoke test
});

// ---- engine -> page ---------------------------------------------------------------------------
function onState(snap) {
  engState = snap;
  for (const e of snap.events) {
    if (e.kind === "blend") { blend = { from: e.from + 1, to: e.to + 1 }; renderDecks(); }
    else if (e.kind === "handoff") {
      blend = null;
      const from = e.from + 1, to = e.to + 1;
      const title = M.deckById(m, to)?.title;
      M.finish(m, from);
      Object.assign(ds[from], { playing: false, pos: 0, len: 0, bpm: 0, peaks: null });
      notice(title ? `Deck ${from} finished. Now playing ${title} on Deck ${to}.` : "", "", 6000);
      renderDecks();
    }
  }
  if (!snap.blend && blend) { blend = null; renderDecks(); }
  for (const d of M.loadedOrder(m)) {
    const e = snap.decks[ei(d.id)], s = ds[d.id];
    if (!e || !e.len) continue;
    s.playing = e.playing; s.pos = e.pos; s.len = e.len; s.srcRate = e.srcRate; s.rate = e.rate;
  }
  const rows = M.describe(m, headRemain()).map(view);
  for (const v of rows) if (v.status === "loaded") syncCard(v.id, v);
  setMeter($("#mL"), snap.masterPeakL);
  setMeter($("#mR"), snap.masterPeakR);
  $("#voices").textContent = `voices ${snap.voices} / 16`;
  if (sampler) sampler.renderPads(snap);
}
function setMeter(el, peak) {
  el.style.width = `${Math.min(100, peak * 100)}%`;
  el.classList.toggle("hot", peak > 0.9);
}

renderDecks();
