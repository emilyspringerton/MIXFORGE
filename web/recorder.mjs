// recorder.mjs -- S513, founder real-time: "mixforge add a record button that works on the
// client side it lets you record the mix and then you can download it or save it to your IDUNA
// sso account." Records exactly what's already going to the speakers -- a MediaStreamAudioDestin
// ationNode fanned out from the same worklet output ctx.destination gets (see mixforge-
// engine.mjs's bootEngine / dj.html's own #start handler) -- via the browser's native
// MediaRecorder, so there's no separate render path that could ever drift from what the DJ
// actually heard. Local download always works; "Save to IDUNA" additionally needs iduna.mjs's
// sign-in.
import * as iduna from "./iduna.mjs";

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/ogg"];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function extFor(mime) {
  return mime.includes("ogg") ? ".ogg" : ".webm";
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtBytes(n) {
  if (n > 1e6) return (n / 1e6).toFixed(1) + " MB";
  if (n > 1e3) return (n / 1e3).toFixed(0) + " KB";
  return n + " B";
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// mountRecorder -- container is an element to render the panel into; stream is the MediaStream to
// record; log(line) is the host page's own log function (recorder events land in the same log box
// as deck/MIDI events rather than a second one).
export function mountRecorder(container, stream, log = () => {}) {
  const mimeType = pickMimeType();
  container.innerHTML = `
    <button id="rf-rec" class="rf-rec"${mimeType ? "" : ' disabled title="MediaRecorder not supported in this browser"'}>&#9679; Record</button>
    <span class="rf-time" id="rf-time"></span>
    <span class="rf-account" id="rf-account"></span>
    <div class="rf-result" id="rf-result" hidden></div>
    <div class="rf-mixes" id="rf-mixes" hidden></div>
  `;
  const recBtn = container.querySelector("#rf-rec");
  const timeEl = container.querySelector("#rf-time");
  const accountEl = container.querySelector("#rf-account");
  const resultEl = container.querySelector("#rf-result");
  const mixesEl = container.querySelector("#rf-mixes");

  let recorder = null, chunks = [], startedAt = 0, timerId = null;

  function renderAccount() {
    const s = iduna.currentSession();
    accountEl.innerHTML = s
      ? `signed in as <b>${esc(s.displayName || s.playerId)}</b> · <a href="#" id="rf-mymixes">my mixes</a> · <a href="#" id="rf-signout">sign out</a>`
      : `<a href="#" id="rf-signin">Sign in to IDUNA</a> to save mixes to your account`;
    const signinLink = accountEl.querySelector("#rf-signin");
    if (signinLink) signinLink.addEventListener("click", (e) => { e.preventDefault(); iduna.startSignIn().then(renderAccount); });
    const signoutLink = accountEl.querySelector("#rf-signout");
    if (signoutLink) signoutLink.addEventListener("click", (e) => { e.preventDefault(); iduna.signOut(); renderAccount(); mixesEl.hidden = true; });
    const mymixesLink = accountEl.querySelector("#rf-mymixes");
    if (mymixesLink) mymixesLink.addEventListener("click", (e) => { e.preventDefault(); toggleMyMixes(); });
  }

  async function toggleMyMixes() {
    if (!mixesEl.hidden) { mixesEl.hidden = true; return; }
    mixesEl.hidden = false;
    mixesEl.textContent = "loading…";
    try {
      const res = await iduna.apiFetch("/api/v1/games/mixforge/recordings");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `list failed (${res.status})`);
      const recs = body.recordings || [];
      if (!recs.length) { mixesEl.textContent = "no saved mixes yet"; return; }
      mixesEl.innerHTML = recs.map((r) => `
        <div class="rf-mix-row">
          <span>${esc(r.name)}</span>
          <span class="rf-meta">${fmtBytes(r.size_bytes)} · ${esc(r.created_at)}</span>
          <button data-id="${esc(r.id)}" data-name="${esc(r.name)}">Download</button>
        </div>`).join("");
      mixesEl.querySelectorAll("button[data-id]").forEach((b) => {
        b.addEventListener("click", () => downloadSaved(b.dataset.id, b.dataset.name));
      });
    } catch (err) {
      mixesEl.textContent = "could not load saved mixes: " + err.message;
    }
  }

  async function downloadSaved(id, name) {
    try {
      const res = await iduna.apiFetch("/api/v1/games/mixforge/recordings/" + encodeURIComponent(id));
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const blob = await res.blob();
      triggerDownload(blob, name);
    } catch (err) {
      log(`download failed: ${err.message}`);
    }
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  function tick() { timeEl.textContent = fmtTime((Date.now() - startedAt) / 1000); }

  function start() {
    if (!mimeType || !stream) return;
    chunks = [];
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = onStopped;
    recorder.start(1000); // 1s timeslice: bounds memory a little and caps loss-on-crash to ~1s
    startedAt = Date.now();
    timerId = setInterval(tick, 250);
    tick();
    recBtn.textContent = "■ Stop";
    recBtn.classList.add("rf-live");
    resultEl.hidden = true;
  }

  function stop() {
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    clearInterval(timerId);
    recBtn.textContent = "● Record";
    recBtn.classList.remove("rf-live");
  }

  function onStopped() {
    const blob = new Blob(chunks, { type: mimeType });
    const durSec = (Date.now() - startedAt) / 1000;
    chunks = [];
    renderResult(blob, durSec);
    log(`recorded ${fmtTime(durSec)} (${fmtBytes(blob.size)}, ${mimeType})`);
  }

  function renderResult(blob, durSec) {
    const url = URL.createObjectURL(blob);
    const defaultName = "mixforge-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    resultEl.hidden = false;
    resultEl.innerHTML = `
      <span class="rf-meta">${fmtTime(durSec)} · ${fmtBytes(blob.size)}</span>
      <a id="rf-dl" href="${url}" download="${esc(defaultName + extFor(mimeType))}">Download</a>
      <button id="rf-save">Save to IDUNA</button>
      <span class="rf-status" id="rf-status"></span>
    `;
    resultEl.querySelector("#rf-save").addEventListener("click", () => saveToIduna(blob, defaultName));
  }

  async function saveToIduna(blob, name) {
    const statusEl = resultEl.querySelector("#rf-status");
    if (!iduna.isSignedIn()) {
      statusEl.textContent = "signing in…";
      const session = await iduna.startSignIn();
      renderAccount();
      if (!session) { statusEl.textContent = "sign-in cancelled"; return; }
    }
    statusEl.textContent = "saving…";
    try {
      const res = await iduna.apiFetch("/api/v1/games/mixforge/recordings", {
        method: "POST",
        headers: { "Content-Type": blob.type, "X-Recording-Name": encodeURIComponent(name) },
        body: blob,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `save failed (${res.status})`);
      statusEl.textContent = `saved as "${body.name}"`;
      log(`saved recording to IDUNA: ${body.name} (${fmtBytes(body.size_bytes)})`);
    } catch (err) {
      statusEl.textContent = "save failed: " + err.message;
    }
  }

  recBtn.addEventListener("click", () => {
    if (!recorder || recorder.state === "inactive") start(); else stop();
  });

  renderAccount();
}
