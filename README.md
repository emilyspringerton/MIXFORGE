# MIXFORGE

A DJ game built on PARENA: four decks, a real 4-channel DJ mixer, a 16-pad MIDI sampler, and a
multiplayer "DJ room" (Turntable.fm-shaped, up to 4 DJs). The DSP (every per-sample mixing and
sampling decision) is written in PARENA and compiled to WebAssembly; the browser is the host.
See `NORTHSTAR.md` for the full plan and history.

## What works today

**4-deck DJ mixer + MIDI sampler: `web/dj.html`** (working, browser)

- **4 decks**: load any audio file the browser can decode (e.g. the tracks `mixforge import`
  downloads), or a built-in synthesized demo loop (drums/bass/chords/arp, 124 BPM). Play/pause,
  cue, click-to-seek, ±8% pitch fader (varispeed), per-deck BPM and **Sync** (beatmatch to deck 1).
- **4-channel mixer**: trim, cubic-taper channel fader, equal-power pan, one-knob DJ filter
  (low-pass left / high-pass right), mute, solo, 3-way crossfader assign (A / Thru / B),
  equal-power crossfader, master, soft-clipping summing bus, peak meters.
- **16-pad MIDI sampler**: pads on MIDI notes 36–51 (or keys `1234 QWER ASDF ZXCV`), velocity
  sensitive; notes outside the pad bank play a chosen **chromatic pad** in exact 12-TET from its
  root; pitch bend ±2 semitones; ADSR per pad, one-shot or gated. **Beat-synced sampling**: grab
  ¼ beat to 2 bars off any deck's playhead into any pad, then play it from MIDI.
- **MIDI control** (Web MIDI — Chrome/Edge; Firefox needs a site permission add-on): CC on MIDI
  channels 1–4 drives decks 1–4 — CC7 fader, CC10 pan, CC74 filter, CC1 pitch, CC2 trim, CC8
  crossfader.
- **Record the mix** (`web/recorder.mjs`, both `dj.html` and `multiplayer.html`): a Record button
  taps a `MediaStreamAudioDestinationNode` fanned out from the exact same worklet output the
  speakers get (never a separate render, so it can't drift from what you actually heard), and
  records it with the browser's native `MediaRecorder` (WebM/Opus, or OGG/Opus on Firefox).
  **Download** always works — verified live in a real headless Chromium session (record → stop →
  a real non-empty audio Blob). **Save to IDUNA**: signs in via a popup to IDUNA's own hosted SSO
  page (`iam.okemily.com`), exchanges that identity for a MIXFORGE-scoped player token
  (`mixforge.play`), and uploads the recording to `POST /api/v1/games/mixforge/recordings` — a
  "my saved mixes" list lets you download them back later. **Fully live end-to-end**, verified
  with a real Playwright run against production: record → stop → sign in via the popup → save →
  the recording appears in "my mixes" with a working download button. Two real, live-only bugs
  were found this way and fixed the same session — the SSO popup was saving its session into its
  own `sessionStorage` instead of the opener's, and a real browser's Content-Type
  (`audio/webm;codecs=opus`) never matched the server's bare-type allowlist — see CHANGELOG.md's
  2026-09-29 entries for both.

Where the code lives: the DSP kernels are `PARENA/stdlib/mixforge/mixer.prn` and `sampler.prn`,
built into `web/dsp.wasm`. `web/engine.mjs` is the host (buffers, voice slots, the frame loop —
the parts PARENA's scalar-only WASM target can't express yet) and calls into `dsp.wasm` for every
decision. `web/dsp-worklet.js` runs it on the audio thread (AudioWorklet).

**The DJ Room: `web/multiplayer.html`** (working, real synchronized playback) — the real, unified
room: the full 4-deck mixer/sampler above, plus a live, multi-seat room (turn order from PARENA
`web/room.wasm`). Built from shared components (`web/deck-strip.mjs`, `web/sampler.mjs`,
`web/midi.mjs`, `web/waveform.mjs`, `web/mixforge-engine.mjs`) rather than a fork of `dj.html`'s
own script — `dj.html` stays exactly as it was, the standalone solo tool; the room evolved
alongside it by importing the same building blocks and adding room-only logic (the WebSocket/turn
state, YouTube acquisition, synchronized-playback scheduling) on top. Deck 1 is the room's shared
deck — whoever's turn it
is pastes a YouTube URL, `server/room_server.mjs` downloads it server-side (`yt-dlp`, no ffmpeg
needed — best audio-only stream, no re-encode), caches it under `web/room-cache/` (served
statically, no new nginx config), and broadcasts a near-future start time; every connected client
independently fetches + decodes the file and schedules playback against that timestamp after a
real round-trip clock-sync (`ping`/`pong`) — **roughly synchronized** (typically low tens of ms),
not sample-accurate, since deck playback is a custom per-sample AudioWorklet loop, not a stock
`AudioBufferSourceNode`. Decks 2-4 stay local (open your own file, practice, sample) — the sampler
(beat-synced pad capture) works off *any* deck regardless of source, so you can sample the room's
current track or your own locally-opened file with the exact same control. Each deck now also
draws a **real waveform** (a min/max peak overview computed from the decoded audio, redrawn with a
live playhead) and runs a **basic, honest BPM estimate** (`web/bpm.mjs` — energy-envelope
autocorrelation, pure JS, labeled `~123 BPM (est.)`, not the real aubio-FFI-bound MIR detector
NORTHSTAR's own Phase 3 still names as future, separate work — no key detection at all, same
reason).

Real, found-live, honestly named limitation: YouTube's own bot-detection intermittently blocks
this server's IP outright (`Sign in to confirm you're not a bot`) — confirmed live, not assumed;
`MIXFORGE_YTDLP_COOKIES` (a Netscape-format cookies.txt path) is the wired-in escape hatch once
real cookies are available. Failures surface as a real, honest `queue_failed` message in the room
UI, not a silent hang.

**Track import CLI: `src/main.c`** (working) — `mixforge import <youtube-url> [instrumental-url]`
downloads via `yt-dlp` into `tracks/main/`, `tracks/instrumental/`, appends to `tracks/library.ndjson`.
Separate code path from the room's own download (this one re-encodes to mp3 via `-x`, needs
ffmpeg; the room's deliberately doesn't, see above).

## Run it

```bash
# needs a sibling ../PARENA checkout (cd ../PARENA && make build) and llc + wasm-ld (LLVM 18)
./scripts/build_dsp_wasm.sh        # builds web/dsp.wasm, runs web/dsp_test.mjs (49 checks)
cd web && python3 -m http.server 8000
# open http://localhost:8000/dj.html, click "Start audio", press "Play all 4"
node web/render_demo.mjs out.wav   # offline: renders a scripted 47s set through the same engine
```

`web/dsp.wasm` is checked in, so the page runs without rebuilding. Room server: `cd server &&
npm install && npm start`, then open `web/multiplayer.html` in a few tabs. Real downloads need
`yt-dlp` on `PATH` (or `MIXFORGE_YTDLP_BIN`) — no ffmpeg required for the room's own download path.

**Bazel**: `bazel test //:dsp_test` runs the real DSP kernel + rendered-audio suite hermetically
against the checked-in `web/dsp.wasm` (zero npm deps — `dsp_test.mjs`/`engine.mjs` import nothing
beyond Node built-ins, same real trade-off MISHRI's own Bazel setup already accepts: hermetic
modulo a system `node` on PATH). `bazel run //:build-wasm` / `//:room-install` / `//:room-server`
/ `//:serve-web` are deliberately non-hermetic `bazel run` convenience wrappers around the real
PARENA+LLVM wasm build, `npm install`, `npm start`, and `python3 -m http.server` respectively —
each needs real network/toolchain/port access a sandboxed Bazel action doesn't get.

## Live

`mixforge.okemily.com` — real, deployed: `web/multiplayer.html` (the real, unified room — see
above, and the domain's front door via `index.html`'s redirect) and `web/dj.html` (the standalone
solo tool) served straight from this repo checkout, `/ws`
proxied to the real, running `server/room_server.mjs` (loopback-only; nginx is the real gate, same
split `jewel-jupyter.service` uses elsewhere in this monorepo). See
`ops/nginx/mixforge-okemily.conf` + `ops/systemd/mixforge-room-server.service` for the exact
config, `IDUNA/ops/terraform/main.tf`'s `cloudflare_dns_record.mixforge` for DNS, and
`sudo-queue/92-mixforge-okemily-domain.sh` / `93-mixforge-mjs-mime-fix.sh` for the deploy scripts.

## Status and limits

- Verified: `web/dsp_test.mjs` — kernel accuracy against `Math` references, plus rendered-audio
  checks (a Goertzel detector measures which frequencies are really in the output) for mute,
  solo, crossfader, pan, filter, pitch, MIDI CC, pads, chromatic pitch, bend, note-off, velocity,
  beat-synced capture and the soft clipper. `PARENA`'s `make test-mixforge-dsp` checks the same
  kernels on the native C target. `server/room_server_test.mjs` — real WebSocket clients, a real
  injectable-stub download (no network calls in CI), covering the full download→play sequencing,
  URL validation, honest failure handling, ping/pong clock sync, and a real, found-live fix (a
  disconnecting current-turn seat now auto-advances the turn instead of stalling the room forever).
  `multiplayer.html` itself was driven headlessly in Chromium end to end against the live server: two
  real tabs join as two real seats, one queues a real YouTube URL, the server downloads real audio,
  both tabs' clocks sync, and the room deck actually plays it (confirmed via a non-zero meter, not
  just message-passing). **Not yet tried with a physical MIDI controller.**
- No key detection at all, and BPM is a basic autocorrelation estimate (`web/bpm.mjs`), not the
  real, aubio-FFI-bound MIR detector NORTHSTAR's own Phase 3 still names as separate, future work.
  Pitch fader is varispeed — no keylock/time-stretch (NORTHSTAR Phase 4).
- Room sync is real but not sample-accurate (typically low tens of ms). **Fixed 2026-09-28**: a
  client joining mid-song now gets a real, unicast `play` message and seeks to the correct
  in-progress position instead of getting nothing until the next track (this was the actual
  "2 tabs say connected but tab 2 doesn't play" bug, found and fixed the same session it was
  reported — see `NORTHSTAR.md`'s own "Real, honest simplifications" section for the before/after
  and the real test proving it). Also fixed alongside it: dead peers (a crashed tab, a dropped
  network) used to occupy their seat forever with no way to free it — a `ws` heartbeat now reaps
  them after ~30s of no pong. YouTube's own bot-detection intermittently blocks the server-side
  download outright; `MIXFORGE_YTDLP_COOKIES` is the wired-in fix once real cookies are available.
- Linear interpolation for resampling (audible aliasing on big pitch-downs of bright material).
