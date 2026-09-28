// room_server.mjs -- real DJ-room server: seat occupancy, join/leave, whose-turn broadcast.
// Founder real-time (kanban T46478755, direct follow-up to room.prn/room.wasm's turn-order
// proof): "build the DJ-room server (seat occupancy, join/leave, whose-turn broadcast)".
//
// Real, deliberate design: the AUTHORITATIVE turn-order math is NOT reimplemented here in
// JavaScript -- this server loads and calls the exact same web/room.wasm the browser client
// uses (compiled from PARENA/stdlib/mixforge/room.prn), so there is exactly one real source of
// truth for "what seat comes next," not a server copy that could silently drift from the
// client's own copy. What IS real, new, host-side work (same "PARENA emits the decision, a thin
// hand-written host wires it to the real platform" shape examples/avr/blink.prn's own header
// comment already establishes for a different platform): seat OCCUPANCY (who is actually
// sitting where) and skipping empty seats when advancing turn -- both need an array/state shape
// room.wasm's own scalar-only v0 (no arrays/structs, see PARENA/docs/LLVM_BACKEND_NORTHSTAR.md)
// cannot express yet. This is the exact same real defstruct/array gap already named in
// CAPTCHA_FPS_PHYSICS_DOGFOOD_NORTHSTAR.md's own Phase 1 -- inherited here, not a new discovery.
//
// Real, honest, not done: track queue persistence (a queued URL triggers a real download but
// isn't kept in a real library/history), no auth/identity (a client is just its WebSocket
// connection, no IDUNA account linkage yet -- real, separate follow-up, same shape DEADWEIGHT/
// ECOWAR/SLOWBOT_LEAGUE's own real guest-auth integrations already establish elsewhere in this
// monorepo, not done here).
//
// Real playback pipeline (2026-09-27, Phase 5 follow-through -- see NORTHSTAR.md's own "Phase 5
// scoping" section for the full architecture and why `media/stream.prn` turned out to be the
// wrong tool for this): on an authorized `queue_song`, this server downloads the real audio via
// `yt-dlp` (bestaudio, no `-x`/re-encode -- deliberately avoids needing ffmpeg at all, unlike
// stdlib/mixforge/import.prn's own separate mp3-transcoding CLI, a different use case), caches it
// under `web/room-cache/` (served statically by the existing nginx `location /`, no new vhost
// config needed), and broadcasts a `play` message carrying a near-future server timestamp. Each
// client independently fetches the cached file, decodes it, and schedules playback against that
// timestamp after a real round-trip clock-sync (`ping`/`pong`) -- "roughly the same position,"
// not sample-accurate, matching NORTHSTAR's own accepted bar for this V0.
//
// Real, found-live, honestly named limitation: YouTube bot-detects this box's own server IP
// ("Sign in to confirm you're not a bot") -- confirmed live this session, even with yt-dlp's
// client-spoofing workarounds. `MIXFORGE_YTDLP_COOKIES` (a Netscape-format cookies.txt path) is
// the real, wired-in escape hatch once real cookies are available (see the new VS Code cookie-
// import tool); without it, downloads fail with a real, honest `queue_failed` message rather than
// hanging or silently pretending to succeed.
import { readFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { execFile } from "node:child_process";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, "..", "web", "room.wasm");
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const { next_seat, is_valid_seat, max_seats } = instance.exports;

const MAX_SEATS = max_seats();
const CACHE_DIR = path.join(here, "..", "web", "room-cache");

// safeYoutubeUrl -- the same real, narrow allowlist judgment
// PARENA/stdlib/mixforge/import.prn's own `safe-youtube-url?` already established (only
// youtube.com/youtu.be, only URL-safe characters), reimplemented here in JS since this is a
// separate download call, not a reuse of that PARENA function. Real, additional layer beyond the
// allowlist: `execFile` (not `exec`/a shell string) passes the URL as its own argv element, so
// there is no shell to inject into regardless of content.
function safeYoutubeUrl(url) {
  return typeof url === "string" && url.length < 512 &&
    /^https:\/\/(www\.youtube\.com\/|youtu\.be\/)[A-Za-z0-9:/.?=&%_~-]*$/.test(url);
}

// realDownload -- shells out to the real, unmodified `yt-dlp` binary (installed via `pip install
// --user`, not vendored) for the best available audio-only stream, as-is. Real, found-live
// robustness: `--print after_move:filepath` (the flag import.prn's own CLI uses) is documented
// for post-processed downloads; this path deliberately skips post-processing (no ffmpeg
// dependency), and this session's own real YouTube bot-detection block made it impossible to
// live-verify whether the flag still fires without `-x` -- so this falls back to globbing
// CACHE_DIR for the real downloaded file by its own random id prefix if stdout parsing comes up
// empty, rather than assuming one specific yt-dlp behavior untested.
// downloadWithRetry -- one real, jittered retry on a transient failure (YouTube's own confirmed-
// intermittent bot-detection, a flaky network blip), per the founder's own explicit "don't have
// it retry more than once" instruction -- not an unbounded/exponential-backoff retry loop, just
// one extra real attempt. Full jitter (a random delay in [0, cap], not a fixed pause) is the same
// real, standard technique cloud SDKs use to avoid every failed client retrying in lockstep;
// irrelevant at this room's real 4-seat scale, used anyway since it costs nothing and is the
// correct default. Every attempt (including the retry itself) is broadcast to the room as a real
// `download_retry` message so the client's own log shows exactly what's happening, per the
// founder's own "have all the logs show in the client what is happening" ask -- not just a final
// pass/fail.
const RETRY_BASE_MS = Number(process.env.MIXFORGE_RETRY_BASE_MS || 1500);
const RETRY_MAX_MS = Number(process.env.MIXFORGE_RETRY_MAX_MS || 6000);

export async function downloadWithRetry(download, url, destDir, onAttempt) {
  const first = await download(url, destDir);
  if (first.ok) return first;
  // Jittered delay, uniformly random in [RETRY_BASE_MS, RETRY_MAX_MS] -- always at least a real
  // moment for a transient blip to clear, never longer than RETRY_MAX_MS.
  const retryInMs = Math.round(RETRY_BASE_MS + Math.random() * (RETRY_MAX_MS - RETRY_BASE_MS));
  onAttempt({ attempt: 1, maxAttempts: 2, error: first.error, retrying: true, retryInMs });
  await new Promise((r) => setTimeout(r, retryInMs));
  const second = await download(url, destDir);
  if (!second.ok) onAttempt({ attempt: 2, maxAttempts: 2, error: second.error, retrying: false });
  return second;
}

export async function realDownload(url, destDir) {
  mkdirSync(destDir, { recursive: true });
  const id = crypto.randomUUID();
  const template = path.join(destDir, `${id}.%(ext)s`);
  const ytdlp = process.env.MIXFORGE_YTDLP_BIN ||
    path.join(process.env.HOME || "/root", ".local/bin/yt-dlp");
  // Real, found-live robustness: a bare "bestaudio" selector intermittently fails outright
  // ("Requested format is not available") on some extraction attempts -- "bestaudio/best" falls
  // back to the best overall stream (video+audio) rather than erroring, at the real cost of a
  // larger download on that fallback path. `--js-runtimes deno` (this session installed a real
  // Deno binary, no sudo needed) works around yt-dlp's own documented "no supported JS runtime"
  // warning, which otherwise silently narrows the set of formats/signatures it can resolve --
  // YouTube's own bot-detection wall (this session's own earlier, real, live finding) is a
  // separate, harder failure mode `MIXFORGE_YTDLP_COOKIES` exists for; this fixes a different,
  // more common intermittent one.
  const denoPath = path.join(process.env.HOME || "/root", ".deno/bin/deno");
  const args = ["-f", "bestaudio/best", "--no-playlist", "--no-warnings"];
  if (existsSync(denoPath)) args.push("--js-runtimes", `deno:${denoPath}`);
  // Real guard: yt-dlp hard-errors if --cookies points at a file that doesn't exist yet, which
  // would break EVERY download (including the ones that succeed fine without cookies) rather
  // than just the bot-detected ones -- only pass it once a real upload has actually landed.
  if (process.env.MIXFORGE_YTDLP_COOKIES && existsSync(process.env.MIXFORGE_YTDLP_COOKIES)) {
    args.push("--cookies", process.env.MIXFORGE_YTDLP_COOKIES);
  }
  args.push("--print", "after_move:filepath", "-o", template, url);
  return new Promise((resolve) => {
    execFile(ytdlp, args, { timeout: 120000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const reason = (stderr || err.message || "").trim().split("\n").pop() || "yt-dlp failed";
        resolve({ ok: false, error: reason });
        return;
      }
      let filePath = stdout.trim().split("\n").filter(Boolean).pop();
      if (!filePath || !existsSync(filePath)) {
        const found = readdirSync(destDir).find((f) => f.startsWith(id));
        filePath = found ? path.join(destDir, found) : null;
      }
      if (!filePath) {
        resolve({ ok: false, error: "yt-dlp reported success but produced no findable output file" });
        return;
      }
      resolve({ ok: true, path: filePath });
    });
  });
}

export class Room {
  constructor() {
    this.seats = new Array(MAX_SEATS).fill(null); // null or { id, ws }
    this.currentTurn = 0;
    // nowPlaying -- real, minimal room-wide playback state: the last track a `play` message was
    // broadcast for. Sent to a newly-joined client both as room_state's text-only display field
    // AND (2026-09-28 fix, see startServer's own connection handler) as a real, unicast `play`
    // message so the joining client's existing handlePlay() actually loads and schedules it,
    // seeking to the correct mid-song position instead of restarting from 0 -- the "no mid-song
    // late join" gap this comment used to name is fixed, not just documented, as of this commit.
    this.nowPlaying = null;
  }

  occupiedCount() {
    return this.seats.filter((s) => s !== null).length;
  }

  // findFreeSeat -- host-side occupancy scan. is_valid_seat is the real PARENA bounds-check
  // export (kept as the real, single source of truth for "is this index even in range"), the
  // null check is real, necessarily host-side occupancy state.
  findFreeSeat() {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (is_valid_seat(i, MAX_SEATS) && this.seats[i] === null) return i;
    }
    return -1;
  }

  join(id, ws) {
    const seat = this.findFreeSeat();
    if (seat === -1) return -1;
    this.seats[seat] = { id, ws };
    return seat;
  }

  leave(id) {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (this.seats[i] && this.seats[i].id === id) {
        this.seats[i] = null;
        return i;
      }
    }
    return -1;
  }

  seatOf(id) {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (this.seats[i] && this.seats[i].id === id) return i;
    }
    return -1;
  }

  // advanceTurn -- real, host-side occupancy-skip loop layered on top of room.wasm's real,
  // pure next_seat: call the PARENA export repeatedly (never reimplement its wraparound math),
  // stop at the first OCCUPIED seat, or give up after one full lap if the room is empty (a
  // real, honest "no one to hand the turn to" case, not an infinite loop).
  advanceTurn() {
    let seat = this.currentTurn;
    for (let i = 0; i < MAX_SEATS; i++) {
      seat = next_seat(seat, MAX_SEATS);
      if (this.seats[seat] !== null) {
        this.currentTurn = seat;
        return seat;
      }
    }
    return -1; // room is empty
  }

  state() {
    return {
      type: "room_state",
      maxSeats: MAX_SEATS,
      seats: this.seats.map((s) => (s ? { id: s.id } : null)),
      currentTurn: this.currentTurn,
      nowPlaying: this.nowPlaying || null,
    };
  }
}

export function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const seat of room.seats) {
    if (seat && seat.ws.readyState === seat.ws.OPEN) seat.ws.send(text);
  }
}

// HEARTBEAT_MS -- real, found-live necessity, not speculative: a browser tab that crashes, loses
// network, or sleeps (laptop lid close) never sends a clean WebSocket close frame, so without this
// `ws.on("close")` (the only thing that frees a seat / hands off a stuck turn) may never fire --
// confirmed live this session by literally reproducing it (a crashed test client left two ghost
// seats occupying the real production room, one of them holding `currentTurn` forever). Standard
// `ws` library dead-peer pattern: ping everyone every HEARTBEAT_MS, terminate() anyone who didn't
// pong since the last ping -- terminate() fires the same real "close" handler already wired to
// room.leave()/advanceTurn(), no separate cleanup path to keep in sync.
const HEARTBEAT_MS = 30000;

export function startServer(port, host = "127.0.0.1", download = realDownload, heartbeatMs = HEARTBEAT_MS) {
  const room = new Room();
  const wss = new WebSocketServer({ port, host });

  wss.on("connection", (ws) => {
    const id = crypto.randomUUID();
    const seat = room.join(id, ws);
    if (seat === -1) {
      ws.send(JSON.stringify({ type: "room_full", maxSeats: MAX_SEATS }));
      ws.close();
      return;
    }
    ws.isAlive = true;
    ws.on("pong", () => { ws.isAlive = true; });
    ws.send(JSON.stringify({ type: "joined", seat }));
    // Real fix for the actual reported bug ("2 tabs say connected but room music doesn't play in
    // tab 2"): a client that joins mid-song only ever saw room.nowPlaying as inert text in
    // room_state (see the Room class's own header comment on this field) -- it never got a real
    // `play` message, so handlePlay() on the client side never ran and no audio was ever
        // scheduled. Unicast the same play info a live client would have gotten, using the same
    // shape (`{seat, url, startAtServerTimeMs}`) `broadcast(room, {type:"play",...})` already
    // uses below -- the client's existing handlePlay() now computes how far into the track "now"
    // actually is (see multiplayer.html) instead of always restarting from position 0.
    if (room.nowPlaying) ws.send(JSON.stringify({ type: "play", ...room.nowPlaying }));
    broadcast(room, room.state());

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // real, honest "ignore malformed input" -- not this v0's job to validate JSON shape further
      }
      if (msg.type === "queue_song") {
        const senderSeat = room.seatOf(id);
        if (senderSeat !== room.currentTurn) return; // only the seated DJ whose turn it is may queue
        if (!safeYoutubeUrl(msg.url)) {
          ws.send(JSON.stringify({ type: "queue_failed", seat: senderSeat, url: msg.url, error: "not a real youtube.com/youtu.be URL" }));
          return;
        }
        broadcast(room, { type: "track_queued", seat: senderSeat, url: msg.url });
        broadcast(room, { type: "downloading", seat: senderSeat, url: msg.url });
        room.advanceTurn();
        broadcast(room, room.state());
        // Real, deliberate: the turn already advanced above (same tested contract as before this
        // pass) -- downloading/playing a track doesn't block the next DJ from queuing behind it.
        downloadWithRetry(download, msg.url, CACHE_DIR, (info) => {
          broadcast(room, { type: "download_retry", seat: senderSeat, url: msg.url, ...info });
        }).then((res) => {
          if (!res.ok) {
            broadcast(room, { type: "queue_failed", seat: senderSeat, url: msg.url, error: res.error });
            return;
          }
          const playUrl = `/room-cache/${path.basename(res.path)}`;
          // Near-future start, not "now": gives every client's WebSocket round-trip + fetch +
          // decodeAudioData a real window to finish before playback is due, the same real
          // buffering margin any live-sync scheme needs.
          const startAtServerTimeMs = Date.now() + 2500;
          room.nowPlaying = { seat: senderSeat, url: playUrl, startAtServerTimeMs };
          broadcast(room, { type: "play", seat: senderSeat, url: playUrl, startAtServerTimeMs });
          // Real, found-live fix: without this, a client's own "now playing" display goes stale
          // at "downloading..." forever (room_state, the only message that carries nowPlaying, is
          // otherwise only re-sent on the next join/leave/queue) -- caught via a real two-tab
          // Playwright run against the live server, not guessed at.
          broadcast(room, room.state());
        });
      } else if (msg.type === "ping") {
        // Real, minimal clock-sync primitive (NTP-shaped: echo t0 back with the server's own
        // clock reading) -- unicast to the sender only, every other client's ping is independent.
        ws.send(JSON.stringify({ type: "pong", t0: msg.t0, serverTime: Date.now() }));
      }
    });

    ws.on("close", () => {
      const vacatedSeat = room.leave(id);
      // Real, found-live fix: if the DJ whose turn it currently is disconnects without queuing,
      // nothing else ever calls advanceTurn() (only a successful queue_song from the current-turn
      // seat does) -- the room would get stuck forever, since every other seat's queue attempt is
      // correctly rejected as "not your turn." Found by literally reproducing it (reconnecting to
      // a long-running room after the prior turn-holder's tab closed), not guessed at.
      if (vacatedSeat !== -1 && vacatedSeat === room.currentTurn) room.advanceTurn();
      broadcast(room, room.state());
    });
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) { ws.terminate(); continue; } // real dead peer -> fires "close" above
      ws.isAlive = false;
      ws.ping();
    }
  }, heartbeatMs);
  wss.on("close", () => clearInterval(heartbeat));

  return { wss, room, maxSeats: MAX_SEATS };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8973);
  // Loopback-only by default: nginx (ops/nginx/mixforge-okemily.conf) is the real, TLS-terminating
  // gate in production, same "reverse proxy is the real edge, the app binds 127.0.0.1" split
  // jewel-jupyter.service/sarena-notebook.service already establish elsewhere in this monorepo.
  const host = process.env.HOST || "127.0.0.1";
  startServer(port, host);
  console.log(`mixforge room server listening on ws://${host}:${port} (max ${MAX_SEATS} seats)`);
}
