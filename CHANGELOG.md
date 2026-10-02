# Changelog

## 2026-10-02

- cookie-exporter extension now released from IDUNA CI (IDUNA/extensions/mixforge-cookie-exporter); README pointer added (sess-20260923-1030-4a526255)


## 2026-09-29
- S513: "Save to IDUNA" is now fully live end to end. Founder ran `sudo-queue/96-mixforge-api-
  proxy-nginx.sh`, deploying the `/api/` same-origin proxy to IDUNA. Re-testing against
  production immediately after (a real Playwright run) caught two real, live-only bugs, both
  fixed the same session: (1) `web/iduna.mjs`'s SSO popup saved its exchanged session into the
  *popup's own* `sessionStorage`, not the opener's (sessionStorage is scoped per top-level
  browsing context and never shared back) -- "Save to IDUNA" registered a real account via the
  popup but then failed "not signed in" back on the main page; fixed by saving in the opener's
  own `onMessage` handler, the context that actually matters. (2) IDUNA's `recordingCreate`
  rejected every real recording because a MediaRecorder's actual Content-Type
  (`audio/webm;codecs=opus`) never exact-matched its bare-type allowlist -- fixed IDUNA-side
  (`mime.ParseMediaType`). Full round trip now confirmed live: record -> stop -> sign in via
  popup -> save -> appears in "my mixes" with a working download button. MIXFORGE@32943c7. (sess-20260923-1030-4a526255)
- S513: client-side mix recorder (founder real-time: "mixforge add a record button that works on
  the client side it lets you record the mix and then you can download it or save it to your
  IDUNA sso account"). New `web/recorder.mjs`: a Record button taps a
  `MediaStreamAudioDestinationNode` fanned out from the exact worklet output that already reaches
  the speakers (added to `mixforge-engine.mjs`'s `bootEngine` for `multiplayer.html`, and inline
  in `dj.html`'s own `#start` handler), and records it via the browser's native `MediaRecorder`.
  Download always works (live-verified in a real headless Chromium session: record -> stop -> a
  real non-empty audio Blob, byte-for-byte fetchable back off its own blob: URL). New
  `web/iduna.mjs`: "Save to IDUNA" opens IDUNA's hosted SSO login page
  (`iam.okemily.com/api/v1/auth/sso/login`) in a popup (so an already-recorded, not-yet-saved mix
  in page memory survives the round trip), exchanges the returned identity token for a
  MIXFORGE-scoped player token via the new `/api/v1/games/mixforge/sso-exchange` (IDUNA `S513`),
  and uploads via `POST .../recordings`; a "my mixes" list lists/downloads them back. Companion
  IDUNA work (`mixforge.play` permission, `mixforge_recordings` BLOB storage, the three
  `recordings` routes) already live and curl-verified against production. **Real, honest, not yet
  live end-to-end**: mixforge.okemily.com's nginx vhost has no same-origin `/api/` proxy to IDUNA
  yet (`ops/nginx/mixforge-okemily.conf` has the block, deploying it needs root --
  `sudo-queue/96-mixforge-api-proxy-nginx.sh`) -- confirmed live via a real Playwright run against
  production: recording works, the SSO popup registers a real account and returns correctly, but
  the sso-exchange fetch currently 404s (nginx's own generic 404, not IDUNA's) until that one
  proxy block is deployed. (sess-20260923-1030-4a526255)

## 2026-09-28
- Fixed the real co-play bug (founder real-time: 2 tabs say connected but room music doesn't play in tab 2): a client joining mid-song only ever got inert nowPlaying text, never a real play message -- now unicast on join, with handlePlay() seeking to the correct in-progress position instead of restarting from 0. Also found and fixed live while reproducing it: dead WebSocket peers (crashed tab, dropped network) used to occupy their seat forever with no way to free it, sometimes stalling currentTurn permanently -- added a standard ws heartbeat that reaps them after ~30s. Both proven with real tests (room_server_test.mjs) and a live end-to-end simulation, restarted the production room-server systemd unit to pick up the fix and clear the stale ghost-seat state it had accumulated. (sess-20260923-1030-4a526255)
- Added an 808 sub bass/kick to the MPC sampler, pad slot 6 (dj.html) -- synthesized (pitch-drop + tanh saturation), live-verified (sess-20260923-1030-4a526255)
- Added a real Bazel build (bazel test //:dsp_test hermetic DSP suite; bazel run //:build-wasm/:room-install/:room-server/:serve-web non-hermetic wrappers), matching the MISHRI Bazel precedent. (sess-20260923-1030-4a526255)
- Added CI for the cookie-exporter Chrome extension (.github/workflows/cookie-exporter-ci.yml): manifest validation, JS syntax check, cookies_test.mjs, and zip packaging -- verified green on a real GitHub Actions run (sess-20260923-1030-4a526255)

- Refactored the DJ room into shared components: extracted deck-strip.mjs/sampler.mjs/midi.mjs/waveform.mjs/mixforge-engine.mjs out of the old room.html duplication; dj.html untouched (still the standalone solo tool); multiplayer.html rebuilt on the shared components as the real unified room (4-deck mix + sampler + waveforms + BPM estimate + YouTube acquisition + local file loading on any deck); room.html retired, index.html now redirects to multiplayer.html (sess-20260923-1030-4a526255)


## 2026-09-27
- Added one real, jittered retry on download failure with full log visibility in the room client. Fixed a real UX gap found live: the root domain (mixforge.okemily.com/) still served the old standalone compiler-proof page instead of the unified room -- moved that proof to wasm-proof.html and made index.html redirect straight to room.html. (sess-20260923-1030-4a526255)
- Unified the DJ mixer and multiplayer room into one real, working page (room.html): server-side download-on-queue, clock-synced playback, real waveform display, basic BPM estimate, sampling off either a local file or the room's live track. Two real bugs found and fixed via live two-tab testing. New Chrome extension (tools/cookie-exporter) uploads real YouTube cookies to a new IDUNA endpoint to work around YouTube's own intermittent server-side bot detection. (sess-20260923-1030-4a526255)
- Phase 5 scoped: synchronized room playback doesn't need media/stream.prn after all -- real architecture is server-side download-on-queue (reusing the mixforge CLI) + nginx static serve + client clock-sync + Web Audio scheduled start; also fixed real nginx repo/live config drift (certbot's SSL additions) (sess-20260923-1030-4a526255)

- feat: real 4-track DJ mixing + 16-pad MIDI sampling, DSP in PARENA compiled to WASM (founder
  real-time: "the actual dj game should have real 4 track mixing and midi sampling"). New
  `PARENA/stdlib/mixforge/mixer.prn` + `sampler.prn` -> `web/dsp.wasm` (`scripts/
  build_dsp_wasm.sh`); `web/engine.mjs` host, `web/dsp-worklet.js` AudioWorklet, `web/dj.html`
  game UI (4 decks with demo loops or local files, trim/filter/pan/fader/mute/solo/xfade-assign,
  crossfader, master, sync; 16 velocity pads, chromatic pad, pitch bend, beat-synced capture off a
  deck, Web MIDI + keyboard), `web/render_demo.mjs` offline WAV render, `web/dsp_test.mjs` 49
  checks (kernel accuracy + Goertzel-measured rendered audio), mutation-checked. Headless
  Chromium run: no console errors, meters/pads/capture work. README rewritten (was empty) as
  `README.md`; CLAUDE.md "blocked on stdlib/media" claim corrected; NORTHSTAR update added.
  Not yet: BPM/key detection, keylock, room audio sync, a physical MIDI controller test.
- Real deploy for mixforge.okemily.com: nginx vhost + systemd unit (running), relative WS URL fix in multiplayer.html, DNS via IDUNA's terraform (sess-20260923-1030-4a526255)

## 2026-09-22 (3)

- feat: real DJ-room server (founder real-time, kanban T46478755: "build the DJ-room server --
  seat occupancy, join/leave, whose-turn broadcast"). New `server/room_server.mjs` -- a real
  WebSocket server (`ws`), real in-memory seat occupancy, real turn broadcasting. Delegates
  authoritative turn-order math to the same `web/room.wasm` the browser client uses (one source
  of truth, not a JS reimplementation); layers a real host-side skip-empty-seats loop on top
  (the genuinely host-side concern room.wasm's own scalar-only v0 can't express). Real
  authorization: a queue_song message from a non-current seat is silently ignored. New `server/
  room_server_test.mjs` -- real WebSocket server + real `ws` client connections (not mocked):
  4-client fill, 5th-client room-full rejection, broadcast fan-out, turn advancement, leave
  dropping occupancy, and the authorization check, all pass. New `web/multiplayer.html` -- a
  real, live multi-tab room UI wired to the server. Honest, not done: no synchronized audio
  (Phase 5 still design-only), no queue persistence, no key/BPM display, no IDUNA identity, no
  multi-room support.

## 2026-09-22 (2)

- feat: first real slice of the DJ-room pivot, PARENA compiled to WASM (founder real-time:
  "build it with parena wasm" -- resolves the room-engine architecture question in favor of
  browser/PARENA-WASM, not a new SHANKPIT OS app). New `PARENA/stdlib/mixforge/room.prn` --
  pure, stateless turn-order/seat-validity logic (`next-seat`, `is-valid-seat`, `max-seats`).
  New `scripts/build_room_wasm.sh` mirrors PARENA's own `make wasm-smoke` recipe exactly
  (parena build -> LLVM IR -> llc -mtriple=wasm32-unknown-unknown -> wasm-ld). New `web/
  index.html` -- a real, live, clickable 4-seat room UI loading and calling `web/room.wasm`
  directly in a browser. New `web/room_smoke_test.mjs` -- 9 real WebAssembly.instantiate
  assertions, all pass (wraparound turn order + out-of-bounds rejection). Real, honest, not
  done: no room/seat multiplayer state, no synchronized audio (still gated on Phase 5's
  media/stream.prn), no track queue, no key/BPM display -- this is the compiler pipeline +
  turn-order rule proven live, not a multiplayer room yet.

## 2026-09-22

- docs: scoped the multiplayer "DJ room" pivot (founder real-time: "up to 4 djs in a room...
  queueing songs from youtube... real dj primitives... assume cruise ship, youtube proxy").
  Named the real prior art (Turntable.fm, 2011-2013, including its own real ASCAP/BMI licensing
  shutdown -- directly load-bearing given this doc's own already-deferred licensing stance).
  Named 3 genuinely new requirement classes: room/seat multiplayer state, synchronized room-wide
  audio playback (promotes Phase 5 streaming from last to a near-term blocker), and clarified
  "youtube proxy" against the already-shipped local-download import pipeline. Real, undecided
  architecture question named: reuse SHANKPIT's own proven multiplayer-room engine vs. a new
  lightweight web room UI. No code shipped. See NORTHSTAR.md's own new addendum section.

## 2026-09-04

- MF-CORE-12441 ("mixforge iterate on the core product"): **this repo's own first real code**,
  `src/main.c` -- a real CLI host, closing the exact gap this repo's own `CLAUDE.md`/`NORTHSTAR.md`
  already named honestly ("no CLI entry point exists yet... nothing calls it from a real
  `main.c` today"). `mixforge import <youtube-url> [instrumental-youtube-url]`: creates the real
  default `tracks/main/`/`tracks/instrumental/` library directories, calls
  `PARENA/stdlib/mixforge/import.prn`'s real, already-tested `import-track` (compiled once via
  `parena build`, generated C committed at `generated/mixforge_gen.c`, same "generate once,
  commit, call by name" precedent every other real PARENA-mod consumer in this monorepo already
  uses), and appends a real NDJSON metadata line to `tracks/library.ndjson` (`track-metadata-json`
  -- real, existed since S243-01, but wasn't exported until this same pass, so nothing could
  reach it before). Real, found-live build gap fixed along the way: the vendored
  `parena_runtime.h`'s own `_POSIX_C_SOURCE`/`_DEFAULT_SOURCE` feature-test macros only take
  effect if no system header has been included yet in the translation unit -- fixed by including
  the generated `.c` (and therefore the runtime header) first in `main.c`, before any of the
  host's own `<stdio.h>`/etc includes, same real ordering fix GoblinFoxDragon's own
  `action_bar_mod_host.h` had to document. Live-verified end to end with the same real
  yt-dlp-stub technique `PARENA/tests/test_mixforge_import.c` already established: real import
  (both single-URL and main+instrumental), real directory creation, real NDJSON output, and real
  rejection (non-zero exit) of a shell-injection-shaped URL. Real, honest, deliberately NOT done:
  playback/crossfade and key/BPM detection both still need real, separate PARENA-side stdlib work
  that doesn't exist yet (`media/audio`/`codec`, an `aubio` FFI binding) -- this CLI's only real
  job is import + local-library bookkeeping, per this repo's own "narrowest real slice first"
  discipline.

## 2026-09-03 (2)

- S243-01: real V0 shipped in `PARENA/stdlib/mixforge/import.prn` (this repo's own code is still
  a NORTHSTAR/CLAUDE.md/CHANGELOG-only stub — the actual implementation lives PARENA-side,
  matching the ECOWAR/PAPERCRAFT/DUNG mod-source convention). Paste a YouTube URL, plus an
  optional second URL for the instrumental, and get a real local download via `yt-dlp` (shelled
  out through `process/run-capture`, `--print after_move:filepath` for the real resulting path).
  Real, layered shell-injection defense: `safe-youtube-url?` is a narrow host+charset allowlist
  (rejects, not merely escapes, anything outside youtube.com/youtu.be plus a fixed safe
  punctuation set), plus `log/projector.prn`'s already-proven `shell-single-quote` as a second
  layer. Metadata is written as a real NDJSON line, honestly not a SQLite row yet (`sql/driver`
  is design-only in PARENA, direct `libsqlite3` FFI-binding is real, separate, unstarted work —
  named, not glossed over). `PARENA/tests/test_mixforge_import.c` (`make test-mixforge-import`)
  verifies real rejection of every real shell-injection payload tried, plus a real stubbed-yt-dlp
  end-to-end download and `import-track` with/without an instrumental. Still open, named
  honestly: no CLI entry point in this repo yet (nothing calls the new library function from a
  real `main.c`), and no automatic `tracks/main/`/`tracks/instrumental/` directory creation
  (`import-track` takes caller-supplied directories today). PARENA commit `77401dc`, Apple
  #17309. (sess-20260902-2008-ed50169e)

## 2026-09-03

- `NORTHSTAR.md` + `CLAUDE.md`: real critical read of `legacy.txt` (the pulled-in AI chat
  transcript that reached a concrete C++/JUCE/Essentia/RubberBand/yt-dlp/SQLite DJ-app design),
  explicitly rejected in favor of building MIXFORGE PARENA-native end to end. Preserved the
  transcript's own real feature set (YouTube-URL track import with an optional separate
  instrumental URL as the explicit first feature, SQLite-shaped library, BPM/key detection,
  Traktor-referenced crossfade/beatmatching) and mapped each onto PARENA's own real stdlib —
  built-in `sdl2` + design-only `media/audio`/`codec` for playback, real `stdlib/shell.prn` for
  a `yt-dlp` import path, FFI-bound `libsqlite3` for the library. Named a genuinely new gap: key/
  BPM detection has no PARENA story anywhere in this monorepo yet, `aubio` (FFI-bound) is the
  leading candidate. 6-phase delivery plan. Registered as `MIXFORGE-NORTH` in
  `EMILY/context/golden-docs-index.md`. (sess-20260902-2008-ed50169e)
