// solo-client.mjs -- single-player's link to the server, for the one thing a browser can't do:
// turn a YouTube link into audio. Opens /ws?solo=1 (no seat, no turn -- see room_server.mjs
// handleSolo), asks it to fetch a track, and resolves with the cached audio's URL + title/artist.
// Tracks are fetched one at a time, in the order they were asked for, so decks fill in queue order
// and yt-dlp isn't hit in parallel.

// normalizeYoutubeUrl -- what the box accepts and what the server's allowlist demands: https, host
// youtube.com or youtu.be, no fragment. Returns null for anything else.
export function normalizeYoutubeUrl(input) {
  let s = String(input || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return null; }
  const host = u.hostname.toLowerCase();
  if (host === "youtu.be") {
    if (u.pathname.length < 2) return null;
    return `https://youtu.be${u.pathname}${u.search}`;
  }
  if (host === "youtube.com" || host === "www.youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/" || u.pathname === "") return null;
    return `https://www.youtube.com${u.pathname}${u.search}`;
  }
  return null;
}

export function createSoloClient({ wsUrl, onStatus = () => {}, WebSocketImpl = globalThis.WebSocket } = {}) {
  let ws = null, up = false, nextReq = 1;
  const pending = new Map(); // reqId -> { resolve, reject, onProgress }
  const chain = []; // fetches waiting for their turn
  let busy = false;

  function connect() {
    ws = new WebSocketImpl(wsUrl);
    ws.onopen = () => { up = true; onStatus("up"); pump(); };
    ws.onclose = () => {
      up = false; onStatus("down");
      for (const [id, p] of pending) { pending.delete(id); p.reject(new Error("lost the connection to the server")); }
      busy = false;
      setTimeout(connect, 2000);
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const p = pending.get(m.reqId);
      if (!p) return;
      if (m.type === "fetching") p.onProgress({ phase: "downloading" });
      else if (m.type === "download_retry") p.onProgress({ phase: m.retrying ? "retrying" : "failed", attempt: m.attempt, maxAttempts: m.maxAttempts, error: m.error, retryInMs: m.retryInMs });
      else if (m.type === "track_ready") { pending.delete(m.reqId); p.resolve({ url: m.url, title: m.title, artist: m.artist }); }
      else if (m.type === "track_failed") { pending.delete(m.reqId); p.reject(new Error(m.error || "download failed")); }
    };
  }

  function pump() {
    if (busy || !up || !chain.length) return;
    const job = chain.shift();
    busy = true;
    pending.set(job.reqId, {
      resolve: (v) => { busy = false; job.resolve(v); pump(); },
      reject: (e) => { busy = false; job.reject(e); pump(); },
      onProgress: job.onProgress,
    });
    ws.send(JSON.stringify({ type: "fetch_track", reqId: job.reqId, url: job.url }));
  }

  connect();
  return {
    isUp: () => up,
    // fetchTrack -- queue a download; the promise settles with { url, title, artist } or rejects.
    // cancel() drops it if it hasn't started (an in-flight download still completes, its result is
    // just ignored by the caller).
    fetchTrack(url, onProgress = () => {}) {
      const reqId = nextReq++;
      let job;
      const promise = new Promise((resolve, reject) => { job = { reqId, url, resolve, reject, onProgress }; });
      chain.push(job);
      pump();
      return { promise, cancel() { const i = chain.indexOf(job); if (i >= 0) { chain.splice(i, 1); job.reject(new Error("cancelled")); } } };
    },
  };
}
