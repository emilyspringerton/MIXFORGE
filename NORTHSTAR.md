# NORTHSTAR — MIXFORGE

## Where this came from

Kanban priority-queue cards (S205-100/101): "intake mixforge legacy conversation northstar it
with our stack not the one discussed built with parena" / "intake MIXFORGE add to golden index
etc." This repo was a bare stub until a real, 1901-line legacy conversation (`legacy.txt`, a
captured AI chat transcript — same "captured conversation as the real source doc" pattern
`LO/LoLanguageSpec.pdf` and `CarePyre/source/gemini-transcript-2026-08-09.md` already
established) was pushed upstream and pulled in. This document is the real, critical read of
that transcript, re-scoped onto this monorepo's own stack per the card's own explicit
instruction.

## What the legacy conversation actually specified

A real, concrete design emerged before the transcript cuts off mid-sentence (repeated "The
server is busy" — it wasn't concluded, just interrupted):

- **The name.** "MixForge" is the transcript's own name for the project, not invented later.
- **First feature, explicitly prioritized above everything else**: import a track by pasting a
  YouTube URL, with a *second, optional* field for a separate YouTube URL carrying the
  instrumental version of the same track (not AI vocal separation — two real, independently
  supplied URLs). Founder's own words in the transcript, preserved verbatim because they're a
  real, deliberate scope decision: "we will handle licensing later this is just going to be a
  crisp workflow for the hobbyist assume they are on a cruise ship in international waters" —
  licensing is explicitly, knowingly deferred, not solved or ignored by omission.
- **Track library**: downloaded audio organized under `tracks/main/` and
  `tracks/instrumental/`, metadata (title, artist, BPM, key, duration, waveform data) in a
  SQLite-shaped `tracks` table, saved mixes under `mixlists/`.
- **Analysis pipeline**: BPM/tempo and musical key detection per track (for harmonic mixing —
  the original ask was "classify the key of the track so we can mix compatible keyed tracks").
- **Mixing**: crossfading plus real beatmatching — time-stretching and pitch-shifting to align
  tempo/key between two tracks, explicitly citing Traktor (iPad) as the feature reference point.
- **The stack the transcript actually converged on** (rejected below, not adopted): C++ +
  JUCE (audio I/O + GUI + plugin format support), Essentia or aubio (key/beat/tempo detection,
  itself depending on FFTW + Eigen), Rubber Band Library (time-stretch/pitch-shift), yt-dlp +
  FFmpeg (YouTube download + transcode), SQLite (metadata), all wired together as git submodules
  under a CMake build.

## Real stack decision: PARENA, not the transcript's own conclusion

The kanban card is explicit: build this "with our stack not the one discussed." The transcript's
own C++/JUCE/Essentia/RubberBand toolchain is a coherent, real answer to the question it was
asked — and is explicitly **not** what gets built here. This repo commits to PARENA end to end,
the same "dogfood the language" discipline PITVIPER/DUNG/SAND/`ECOWAR`'s own mod layer already
follow elsewhere in this monorepo. Mapping the transcript's own real component list onto what
PARENA actually has (checked directly against `PARENA/stdlib/`, not assumed):

| Legacy conversation's own answer | PARENA-native replacement | Real status, checked |
|---|---|---|
| JUCE (audio I/O + GUI) | Built-in `sdl2` (STDLIB.md: "SDL2 is built in, no import needed") + `media/audio` (`open-device`/`play`/`mix`) | `sdl2` real; `media/audio` **design-only**, no `.prn` yet |
| yt-dlp + FFmpeg (download/transcode) | Real `stdlib/shell.prn` shelling out to the real, unmodified `yt-dlp`/`ffmpeg` binaries — same real external-tool-invocation pattern already dogfooded into PITVIPER, not a from-scratch reimplementation of either tool | `shell.prn` **real, exists today** |
| SQLite (metadata) | FFI-bind real `libsqlite3` (same judgment already applied to codecs — "FFI-bind real libs," not reimplement), *or* PARENA's own future `sql/driver` (`STDLIB.md`: "construction blocks, implementation deferred") once that lands | Neither exists yet; FFI-bind is the faster real path |
| Essentia/aubio (key + BPM detection) | **No PARENA equivalent exists at all** — not even a design-only stdlib section names this. Real, new gap, see below. | Missing entirely, not just unimplemented |
| Rubber Band Library (time-stretch/pitch-shift) | FFI-bind the real Rubber Band library directly (same "FFI-bind real libs" judgment as codecs) | Not scoped anywhere yet; a new, narrow FFI-binding target |
| CMake + git submodules | PARENA's own `parena build` + this monorepo's own vendoring convention (e.g. `packages/simulation/parena_runtime.{h,c}` vendored verbatim into PAPERCRAFT) for any FFI-bound C library | N/A — build tooling, not a stdlib gap |

## Real, current blockers — checked, not assumed

Two real gaps, of different sizes:

1. **`stdlib/media/audio.prn` / `media/codec.prn` don't exist as code.** `STDLIB.md` §26-27 is a
   resolved API-surface design (FFI-bind a real audio/codec library, function names mirror it)
   but zero `.prn` source exists in `PARENA/stdlib/` today. MIXFORGE's own playback/crossfade
   can't start until this lands — real PARENA-repo work, not MIXFORGE-repo work, same
   cross-repo dependency shape `ECOWAR` has on `PARENA/stdlib/ecowar/*.prn`.
2. **Key/BPM detection has no PARENA story at all — a genuinely new gap, bigger than #1.**
   Unlike audio playback (a real, already-scoped design waiting on implementation), music
   information retrieval (chroma-vector key estimation, onset-detection-based tempo tracking)
   has never been discussed anywhere in this monorepo before this document. The honest,
   pragmatic answer, consistent with the "FFI-bind real libs" judgment `linalg`'s own BLAS/LAPACK
   note and the codec section both already establish: FFI-bind a real, existing library
   (`aubio` — the transcript's own named lighter-weight alternative to Essentia, a plain C
   library with no C++ ABI complications) rather than reimplementing MIR algorithms from
   scratch in PARENA. This needs its own real scoping pass before Phase 3 below starts; not
   attempted in this document.

## Scope

### In scope (V0)
- **Shipped 2026-09-03 (S243-01)**: the transcript's own explicitly-first feature, paste a
  YouTube URL (plus an optional second URL for the instrumental) and have it land in a real
  local track library. `PARENA/stdlib/mixforge/import.prn` — real download via
  `stdlib/process.prn`'s `run-capture` shelling out to the real `yt-dlp` binary (this file
  ended up using `process.prn`, not `shell.prn`, once written — `run-capture`'s own real
  synchronous "run + capture stdout + real exit code" shape is what this needs; `shell.prn`
  itself is for spawning an interactive PTY shell, a different real primitive). Real, layered
  shell-injection defense (`safe-youtube-url?` narrow allowlist + `log/projector.prn`'s proven
  `shell-single-quote`), live-verified via `make test-mixforge-import` (stubbed yt-dlp, real
  injection-payload rejections, real Ok/Err propagation). Metadata is written as a real NDJSON
  line per import, not a real SQLite row yet — see the file's own header comment for why (the
  SQLite/`sql/driver` half of "a real local track library" below is still open).
- Still open: querying the NDJSON metadata log as a real local track library (a
  `project-sqlite!`-style projector, once MixForge actually needs to query it — same real,
  already-proven "flat log first, DB projector later" shape `log/projector.prn` establishes
  elsewhere), and organizing downloaded files under `tracks/main/`/`tracks/instrumental/`
  directories at the CLI-wiring layer (`import-track` itself takes any caller-supplied
  directories — creating/choosing the real default directories is the next, thin wiring step,
  not done yet since MIXFORGE has no `main.c`/CLI entry point at all today).
- Two-deck playback + crossfade once Phase 0 (`media/audio`/`codec`) lands — the same V0 bar
  the pre-legacy-transcript draft of this document already set, now sequenced correctly after
  the library/import feature the transcript itself said comes first.
- Two-deck playback + crossfade once Phase 0 (`media/audio`/`codec`) lands — the same V0 bar
  the pre-legacy-transcript draft of this document already set, now sequenced correctly after
  the library/import feature the transcript itself said comes first.

### Explicitly not V0
- BPM/key detection and beatmatching (time-stretch/pitch-shift) — real, named, Phase 3+ below,
  blocked on the new MIR-library FFI gap above, which needs its own scoping pass first.
- Any actual DRM/licensing handling — deliberately, explicitly deferred per the transcript's own
  founder quote, not solved here or anywhere in this document.
- Stem separation / AI vocal removal — the transcript's own "instrumental" feature is two
  separately-supplied URLs, not audio-source-separation; nothing here implies that's a future
  V-next either unless asked for directly.
- A polished GUI — same open question the earlier draft of this document already named (see
  below); V0's own import+library feature is plausibly CLI/form-driven before any deck UI exists.

## Delivery plan

1. **Phase 0 — the real stdlib gap.** `stdlib/media/audio.prn` + `media/codec.prn` (PARENA repo
   work), following `STDLIB.md` §26-27's already-resolved API surface. Needed for Phase 2
   (playback), not for Phase 1 (import/library) below, which only needs `shell.prn` (already
   real) plus a real sqlite FFI binding.
2. **Phase 1 — YouTube import + track library.** The transcript's own real first feature, built
   first here too: a form/CLI taking a main URL + optional instrumental URL, `shell.prn`-invoked
   `yt-dlp` download, metadata stored via a real sqlite FFI binding, files laid out under
   `tracks/main/`/`tracks/instrumental/`. Success bar: paste two real YouTube URLs, get two real
   local audio files plus a real library row.
3. **Phase 2 — two-deck crossfade, headless.** Once Phase 0 lands: load two library tracks via
   `media/codec`, cross-fade via `media/audio`'s real `mix` primitive, play via
   `open-device`/`play`. Matches the earlier draft's own Phase 1 bar, now correctly sequenced
   after the library feature actually exists to load tracks *from*.
4. **Phase 3 — key/BPM detection.** Its own real scoping pass first (which library, FFI ABI
   shape, chroma/onset algorithm choice) — not assumed solved by this document.
5. **Phase 4 — beatmatching.** Rubber Band FFI binding + UI/control for real-time time-stretch/
   pitch-shift during a live mix, using Phase 3's own BPM/key output to drive it.
6. **Phase 5 — live streaming.** `stdlib/media/stream.prn` (real, currently design-only, same
   status as `media/audio`), closing the founder's own separately-stated "full audio and video
   streaming" / "avoids third-party relay overhead" motivation from `PARENA/STDLIB.md`.

## Open questions

1. **GUI vs. headless/scriptable-first** — same real, undecided question the earlier draft of
   this document named: does MIXFORGE need a real visual deck UI, or does a scriptable-first V0
   (dogfooding PARENA's own `editor` stdlib plugin surface, matching `DUNG`'s precedent) count
   as a legitimate real product on its own? Phase 1 (import/library) doesn't force this
   decision; Phase 2 (interactive crossfade) does.
2. **sqlite FFI vs. PARENA's own future `sql/driver`** — Phase 1 needs a real metadata store
   now; `sql/driver` is explicitly "implementation deferred" per `STDLIB.md`. Bind sqlite
   directly for Phase 1, revisit once `sql/driver` is real.
3. **aubio vs. an alternative MIR library** for Phase 3 — the transcript names both Essentia and
   aubio; aubio's plain-C ABI is the more natural PARENA FFI target, but this isn't a final
   pick, just the leading candidate pending Phase 3's own real scoping pass.
4. **Relationship to `PITVIPER`'s own `pitviper/quicklook`** (`STDLIB.md` line 95, also depends
   on `media/codec`/`media/audio`) — share code once those exist, or develop independently?
   Not decided here.

## Pivot: the multiplayer DJ room (2026-09-22, same-session addendum)

Founder real-time: "there was a game we all used to play when i worked at a startup - like up to
4 djs in a room and you would see each person had a dj table set up at a wall of the room and you
would go around the room queueing songs from youtube - lets pivot the mixforge app into that
somehow with real dj primitives built in so i can run 2 youtubes at once or at least our proxy
for the youtube and i can get like intelligent key information on the current playing song etc -
again assume they are all on a cruise ship and the tech is a youtube proxy."

**Real, named prior art, not invented from the description alone:** this is Turntable.fm
(2011-2013) — a real, well-known product with this exact shape: a room holds up to five DJ booth
seats, each occupied DJ queues tracks, everyone in the room hears the current DJ's track together,
the crowd votes "awesome"/"lame." Naming it because its own real history is directly load-bearing
here, not just trivia: **Turntable.fm was sued by ASCAP/BMI and major labels over public-
performance licensing for exactly this "synchronized shared listening room" mechanism, and that
pressure was a real factor in its eventual shutdown.** This doc's own existing "cruise ship /
international waters" framing (from the original legacy transcript, §"What the legacy
conversation actually specified" above) already names licensing as explicitly, knowingly
deferred, not solved — the pivot doesn't change that stance, but it does raise the real stakes of
it, since a synchronized multi-listener room is a materially bigger public-performance surface
than one hobbyist's own local two-deck mix. Named here plainly so it's a real, informed choice
going forward, not a silently-inherited risk.

**What's genuinely new versus everything scoped above (Phases 0-5):** every existing phase is
still needed — import/library (shipped), two-deck crossfade, BPM/key detection, beatmatching —
but they now get consumed by a ROOM, not a solo user. Three real, new requirement classes:

1. **Room/seat multiplayer state** — up to 4 DJ booth seats, occupancy, a queue-then-DJ turn
   order ("go around the room queueing songs"), spectator/listener presence. No existing MIXFORGE
   code touches this at all; the closest real precedent in this monorepo is `SHANKPIT/apps/lobby`
   (seat/room occupancy) and IDUNA's guest-auth/room-join patterns already proven for DEADWEIGHT/
   ECOWAR/SLOWBOT_LEAGUE.
2. **Synchronized room-wide audio playback — the single hardest new piece, harder than anything
   scoped so far.** Every listener in the room needs to hear the SAME track, in sync, at
   (roughly) the same playback position, over a network — a real, hard, "shared listening"
   distributed-systems problem, not a local two-deck crossfade problem. This directly promotes
   Phase 5 ("live streaming," `stdlib/media/stream.prn`, previously the LAST phase, design-only,
   named only for its own future "full audio/video streaming" motivation) into a real,
   near-term blocker — the room pivot can't work without it, so it needs resequencing earlier
   relative to Phases 2-4, not left last.
3. **"2 youtubes at once, or our proxy" clarified against the real, already-shipped mechanism**:
   MIXFORGE's own real V0 (`import.prn`) already downloads a track locally via `yt-dlp` rather
   than live-relaying a YouTube stream — this is actually the SAFER shape versus what Turntable.fm
   did (which live-relayed audio in real time), not a new thing to build. "2 youtubes at once" is
   the existing Phase 2 two-deck concept (already scoped), now needing to run per-DJ-seat instead
   of per-solo-user. "Our proxy for the youtube" already exists in embryonic form as this same
   import pipeline — the real remaining gap is turning a downloaded file into a room-wide
   synchronized stream (item 2 above), not fetching it in the first place.

**Real, undecided architecture question, not guessed at here:** does the ROOM itself need a real
rendered space ("each person had a dj table set up at a wall of the room" implies a real, visible
spatial layout, not a plain list UI)? If so, this monorepo already has a proven multiplayer-room
rendering + netcode engine (`SHANKPIT`'s own lobby/apps pattern, C/SDL2, server-authoritative) —
reusing it (a DJ room as a new SHANKPIT OS app, matching this session's own IDUNA.GAME/REDGARDEN/
EDITOR.GAME additions) is a real, live option versus building a new lightweight web room UI from
scratch. Not decided here — a real founder call, same shape as this doc's own existing open
question 1 (GUI vs. headless), now with higher stakes since a room implies more UI than a solo
deck ever did.

**Update (same day): architecture question resolved, first real slice shipped.** Founder
real-time: "build it with parena wasm" — resolves the room-engine question above in favor of a
browser/PARENA-WASM stack (not a new SHANKPIT OS app). Real, live first slice:
`PARENA/stdlib/mixforge/room.prn` — pure, stateless turn-order/seat-validity logic (`next-seat`,
`is-valid-seat`, `max-seats`), the "go around the room" rule made real. Built via `scripts/
build_room_wasm.sh` through the exact pipeline `PARENA/docs/LLVM_BACKEND_NORTHSTAR.md`'s own
`make wasm-smoke` already proved (`parena build` → LLVM IR → `llc -mtriple=wasm32-unknown-
unknown` → `wasm-ld` → a real `.wasm`), checked in at `web/room.wasm`, loaded and exercised for
real by `web/index.html` (a real, live, clickable 4-seat room UI in a browser tab) and verified
headlessly by `web/room_smoke_test.mjs` (real `WebAssembly.instantiate` execution, 9 assertions,
all pass — wraparound turn order and out-of-bounds seat rejection both checked).

**Update (same day): real room server shipped.** `server/room_server.mjs` — a real WebSocket
server (`ws` package), real in-memory seat occupancy (join assigns the first free seat via the
same `room.wasm` `is_valid_seat` export, leave frees it), and real turn broadcasting. Deliberately
does NOT reimplement turn-order math in JavaScript: it loads and calls the exact same `web/
room.wasm` the browser client uses, so there is one real source of truth for "what seat comes
next," with only the genuinely host-side concern (occupancy — an array/state shape `room.wasm`'s
own scalar-only v0 can't express, the same `defstruct`/array gap named in `CAPTCHA_FPS_PHYSICS_
DOGFOOD_NORTHSTAR.md`) layered on top as a skip-empty-seats loop. Authorization is real too: a
`queue_song` message is silently ignored unless it comes from the seat whose turn it currently is.

Real, live, passing test (`server/room_server_test.mjs`) — a REAL WebSocket server, REAL `ws`
client connections (not mocked): 4 clients fill the room in seat order, a 5th is rejected with
`room_full`, seat 0 queues a song and every other client receives the real broadcast, turn
correctly advances to seat 1, a client leaving drops occupancy to 3, and a queue attempt from a
non-current seat is correctly ignored (the authorization check, not just the happy path). New
`web/multiplayer.html` — a real, live multi-tab room UI (open several tabs, watch real, separate
seats fill) wired to this server over the same real `ws://127.0.0.1:8973` protocol the test
exercises. `web/index.html` (the earlier, server-less compiler-pipeline proof) stays as-is, a
smaller, simpler artifact for that narrower purpose.

**Real, honest, still NOT done:** no synchronized audio (still gated on Phase 5's `media/
stream.prn`, still design-only — a client can announce "I'm playing this URL" but nothing plays
it for anyone else yet), no track queue persistence (a queued URL is broadcast and forgotten),
no key/BPM display, no IDUNA account/identity (a "seat" is just a WebSocket connection, no login),
no room listing/creation (exactly one hardcoded room, no multi-room support). Real, concrete next
step: either Phase 5 (`media/stream.prn`) scoping, since it's the real remaining blocker for
anyone actually hearing what gets queued, or IDUNA identity integration, matching the same
guest-auth pattern DEADWEIGHT/ECOWAR/SLOWBOT_LEAGUE already established — not decided here.

## Update 2026-09-27: real 4-track mixing + MIDI sampling (PARENA DSP -> WASM)

Founder real-time: "continue building MIXFORGE DJ game in PARENA primatives the actual dj game
should have real 4 track mixing and midi sampling." Built as the solo DJ surface the room will
later host, on the same PARENA-WASM stack the room pivot chose:

- `PARENA/stdlib/mixforge/mixer.prn` — the 4-channel DJ mixer's math: cubic fader taper,
  equal-power pan and crossfader (polynomial quarter-cosine, < 3e-5 from `cos`; there is no libm on
  the WASM target), mute/solo, A/Thru/B crossfader assign, one-knob low-/high-pass DJ filter,
  pitch-fader tempo, beatmatch rate, soft-clipping summing bus, meter ballistics.
- `PARENA/stdlib/mixforge/sampler.prn` — MIDI 1.0 decoding (note on/off incl. velocity-0, CC,
  14-bit pitch bend), 16-pad map on notes 36–51, exact 12-TET note→rate (semitone × octave
  tables, no pow), bend rate (< 1 cent), velocity curve, CC→mixer map, interpolation, ADSR, and
  beat-synced capture length.
- `web/engine.mjs` (host: buffers, voices, frame loop), `web/dsp-worklet.js` (AudioWorklet),
  `web/dj.html` (4 strips, master, 16 pads, Web MIDI, keyboard pads, capture-to-pad), `web/
  render_demo.mjs` (offline WAV render), `web/dsp_test.mjs` (49 checks incl. Goertzel-measured
  audio assertions).

This resequences the plan: Phase 2 (crossfade) is done in the browser and exceeds its bar (4
decks, not 2), without `stdlib/media/audio.prn` — Web Audio is the device layer, PARENA is the
DSP. Two real LLVM-backend bugs found and fixed in PARENA along the way (`src/emit_llvm.c`: F64
literal operands on the left of an op were typed I32; function bodies over 512 bytes were
silently truncated), with regression tests.

Still open, named: BPM/key detection (Phase 3 — BPM is typed in today), keylock/time-stretch
(Phase 4), wiring the mixer into the room (a DJ's master out → room listeners, Phase 5 streaming),
and a test with a physical MIDI controller (only headless Chromium + synthetic MIDI so far).

## Phase 5 scoping (2026-09-27): real architecture for synchronized room playback

Founder real-time, routed via `emily observe` before this pass started: confirmed after finding
that queuing a song in the live multiplayer room (`multiplayer.html`) does nothing but broadcast
a log line — real seats/turns/authorization all work, no audio plays for anyone. Asked to scope
Phase 5 (the thing every prior update above named as the real remaining blocker) rather than
patch around it.

**Real, load-bearing finding: `stdlib/media/stream.prn` is the wrong tool for this job.** Its own
resolved design (`PARENA/STDLIB.md` §28, "media/stream") exists for a different, differently-shaped
problem — one native process publishing ONE outbound stream to MULTIPLE external destinations
(`connect-destination`/`publish` fan-out to a `Vec StreamDest`, the founder's own stated motivation
being "dual stream to multiple services... for overhead and security reasons," i.e. a Twitch/
YouTube-style multi-destination relay). The room's actual need is the reverse shape: get several
already-connected BROWSER TABS to play the SAME already-downloaded file at (roughly) the same
position. Those aren't the same problem, and `media/stream.prn` is still design-only regardless
(zero `.prn` source exists) — waiting on it would be blocking real, buildable work behind an
unrelated, unbuilt dependency. **Same pattern this repo already lived through once**: the 2026-09-27
4-deck mixer update above shipped real two-deck-and-beyond crossfade entirely on Web Audio +
PARENA-WASM DSP, without ever needing `media/audio.prn` (also still design-only) — a native PARENA
audio stdlib turned out not to be the actual dependency once the real browser-native primitive was
looked at directly. The same reframe applies here: **the room doesn't need a new PARENA stdlib
domain to play synchronized audio; it needs a small, real, host-side/browser-native design.**

### Real architecture

Two real gaps close this, both buildable on infrastructure that already exists:

1. **Server-side download-on-queue, reusing the already-shipped import pipeline.** When a seated
   DJ's `queue_song` message is accepted (existing authorization check in `room_server.mjs`
   already gates this), the room server shells out to the real, already-built `mixforge` CLI
   (`mixforge import <url>` — `MF-CORE-12441`, real and compiled today) into a room-scoped cache
   directory, the same "shell out to the real compiled tool" pattern this monorepo already uses
   everywhere else (PITVIPER, `git.prn`, `import.prn`'s own `yt-dlp` call) rather than
   reimplementing the download logic a second time in JavaScript. This is genuinely new
   `room_server.mjs` work (a `child_process` call + a completion message), not new PARENA work.
2. **Client-side synchronized start, pure Web Audio, no server-side audio processing at all.**
   Once the file is cached server-side, nginx already knows how to serve a static file from a
   directory (exactly the pattern this session's own MIME-type fix just proved out) — no new
   streaming server needed, an HTTP file is enough since these are finite downloaded tracks, not
   an open-ended live feed. Each client `fetch()`s the same URL and decodes it locally via
   `AudioContext.decodeAudioData` (the same API `engine.mjs` already uses for the sampler). The
   server then broadcasts one `{type: "play", url, startsAtServerTimeMs}` message; each client
   estimates clock offset via a real, minimal round-trip ping (send a timestamp, server echoes it
   back with its own clock reading, offset = server_time - (t0 + rtt/2) — the same math NTP/every
   game-netcode clock-sync scheme already uses, nothing PARENA-specific to invent), converts the
   target wall-clock start into a `ctx.currentTime` offset, and calls `source.start(when)` —
   Web Audio's own sample-accurate scheduling primitive does the actual synchronized playback;
   this needs no new PARENA capability, no new native audio stack, and no `media/stream.prn`.

### Real, honest simplifications for a buildable V0 (named, not silently dropped)

- **A real, user-visible delay between "queued" and "playing"** — downloading via `yt-dlp` takes
  real seconds, unlike Turntable.fm's own live-relay model. The room UI needs a `downloading...`
  state; this is a real, new UX cost this architecture accepts rather than hides.
- ~~**No mid-song late join**~~ — **fixed 2026-09-28** (founder real-time: "can we make the coplay
  stuff actually function in mixforge it doesnt actually work if i open 2 tabs it says connected
  but the room music doesnt play in tab 2" — this WAS the bug, reproduced live before fixing:
  a fresh two-tab test against production showed the *first* tab wasn't even reliably getting
  `currentTurn`, because of the second, related bug below). `room_server.mjs`'s connection handler
  now unicasts a real `{type:"play",...}` to a joining client whenever `room.nowPlaying` is set
  (previously that info only reached `room_state`'s inert text field); `multiplayer.html`'s
  `handlePlay()` now computes how many seconds into the track "now" actually is
  (`elapsedSec = (Date.now() - localTarget) / 1000`) and seeks there, instead of always restarting
  from 0 — the same real math that already scheduled synchronized starts, extended to cover a
  start that's already in the past. If the track already finished by join time, it honestly logs
  that and waits for the next one rather than replaying stale audio. Real test:
  `server/room_server_test.mjs`'s "late-join fix" block (a client joins after another has already
  queued+played, asserts it gets a real `play` message with the original `startAtServerTimeMs`).
- **Fixed alongside it, found live while reproducing the above**: dead WebSocket peers (a crashed
  tab, a dropped network, a laptop sleep — anything that skips a clean close frame) used to occupy
  their seat forever, since nothing but a clean `close` event ever freed one; if that seat held
  `currentTurn`, no one could ever queue again. A real two-tab Playwright repro against the live
  production room hit exactly this: seats were already stuck occupied from earlier testing before
  any new tab connected. Fixed with the standard `ws` heartbeat pattern — `room_server.mjs` pings
  every client every 30s (configurable via `startServer`'s 4th arg, used to keep
  `room_server_test.mjs`'s "heartbeat fix" test fast) and `terminate()`s anyone who didn't pong
  since the last ping, which fires the existing `close` handler (seat-free + turn-handoff), no
  separate cleanup path.
- **Each client downloads its own copy** — fine at the real 4-seat/small-room scale this repo
  targets; a true single-relay-fan-out (closer to what `media/stream.prn` was actually designed
  for) is a real, later option if room sizes ever grow, not needed for V0.
- **Licensing stakes, already named in the multiplayer-pivot section above, go up again**: this
  design adds a real, server-side cached copy of downloaded audio (not just a hobbyist's own local
  file), serving it to multiple listeners over HTTP. Still explicitly, knowingly deferred per this
  doc's own standing "cruise ship / international waters" stance — named again here because a
  shared server-side cache is a materially bigger fact than Phase 1's own single-user local
  download, same honesty standard the Turntable.fm/ASCAP-BMI note above already set.

### Phased build order (not started — this section is the scoping pass only)

1. **5a** — `room_server.mjs` shells `mixforge import` on an accepted `queue_song`, caches under a
   room-scoped directory, replaces today's fire-and-forget `track_queued` broadcast with a real
   `downloading` → `ready` state machine.
2. **5b** — nginx (or the room server itself) serves the cached file statically; verify Range-
   request support (needed for `decodeAudioData`/seek, not just sequential playback).
3. **5c** — client round-trip clock sync + `AudioContext`-scheduled synchronized `start(when)`.
4. **5d (deferred, named not guessed)** — late-join seek-to-current-position; true single-relay
   fan-out if room sizes grow past a handful of listeners.

### Implemented (2026-09-27, same day as the scoping above) — real, live, working

Founder real-time: "unify the dj interface and the multiplayer room and make it so it actually
works", then mid-build: "it needs to show the waveforms in the cdjs... bpm detection and key
detection" and "it still needs to let you open files and sample off of either the file you opened
or the youtube 'stream' you opened". Built and live-verified, not just scoped:

- **`web/room.html`** — the real unification: the full 4-deck mixer/sampler from `dj.html` plus
  the room from `multiplayer.html`, in one page. Deck 1 is the room's shared deck (loads whatever
  the room is currently playing); decks 2-4 stay local. The sampler needed zero new code to
  satisfy "sample off either source" — `capturePad` already samples off whatever's loaded into a
  deck, source-agnostic, so a room-sourced deck 1 and a locally-opened deck 2-4 work identically.
- **`server/room_server.mjs`** — real download-on-queue (`yt-dlp -f bestaudio/best`, no ffmpeg),
  caches under `web/room-cache/` (served by the existing static `location /`, no nginx change
  needed), broadcasts a near-future `play` timestamp; clients round-trip clock-sync (`ping`/`pong`)
  and schedule `deckParam playing=true` against it. **Correction from the scoping doc above**: not
  Web Audio's sample-accurate `start(when)` after all — deck playback is a custom per-sample
  AudioWorklet loop, not a stock `AudioBufferSourceNode`, so this is `setTimeout`-scheduled
  (typically low tens of ms accuracy), matching NORTHSTAR's own "roughly synchronized" bar, not
  claiming more than that.
- **Real waveform display** (`drawWaveform`/`redrawWave` in `room.html`) — a min/max peak overview
  cached to an offscreen canvas once per load, redrawn cheaply with a live playhead at the
  existing ~30Hz UI tick.
- **Real, basic BPM estimate** (`web/bpm.mjs`) — energy-envelope autocorrelation, pure JS, no new
  dependency, per the founder's own explicit choice ("basic JS heuristic now" over building the
  full aubio pipeline). Labeled an estimate in the UI and log, never presented as ground truth.
  **No key detection** — that one genuinely has no lightweight equivalent, per the founder's own
  acknowledgment when choosing this option.
- **Two real bugs found and fixed via actual two-tab Playwright testing against the live server**,
  not guessed at: (1) a client's "now playing" display went stale at "downloading..." forever —
  `room.nowPlaying` was set but no fresh `room_state` broadcast followed to deliver it; (2) if the
  seat whose turn it is disconnects without queuing, nothing ever called `advanceTurn()` — the
  room got stuck forever, since every other seat's queue attempt is correctly rejected as "not
  your turn." Both fixed; the second has a real test (`room_server_test.mjs`) exercising an actual
  WebSocket close, not a synthetic state mutation.
- **Real, live-confirmed nuance on the YouTube bot-detection finding above**: it's intermittent,
  not an absolute wall — a real download of a real video succeeded live during this session's own
  testing (a 3.4MB WebM, decoded and played with zero errors), while other attempts hit either the
  bot-detection wall or a separate "requested format is not available" failure. Installed a real
  Deno binary (`~/.deno/bin/deno`, no sudo) and wired `--js-runtimes deno:<path>` into the
  download call, since yt-dlp's own startup warning names a missing JS runtime as narrowing
  available formats/signatures — a real, distinct, likely-more-common failure mode from the bot
  wall itself, which still needs real cookies (`MIXFORGE_YTDLP_COOKIES`) to reliably get past.
- **Cookie-export tool, real technical correction made mid-build**: the founder's own two proposed
  approaches (a VS Code extension hosted at `console.okemily.com`, then "fork our own chrome to
  defeat the security boundaries") both misjudged where the real boundary is. A remote
  code-server extension can't reach a local desktop browser's cookie store at all (wrong
  machine); same-origin policy blocks a *webpage's* JS from reading another origin's cookies, but
  a browser *extension* with the `cookies` permission scoped to `youtube.com` has sanctioned,
  official API access to exactly those cookies — no boundary to defeat, no fork needed. Real,
  minimal Chrome extension built instead (see its own README) — see the monorepo `CLAUDE.md`'s
  `MIXFORGE_YTDLP_COOKIES` wiring above for where the exported cookies land.
- **One real retry (jittered), full visibility in the client log**: founder real-time, "can we
  give a jitter retry like when it denies have it retry have all the logs show in the client what
  is happening", then "dont have it retry more than once" -- `downloadWithRetry` in
  `room_server.mjs` does exactly one retry after a random jittered delay (uniform in
  `[MIXFORGE_RETRY_BASE_MS, MIXFORGE_RETRY_MAX_MS]`, default 1.5-6s), broadcasting a real
  `download_retry` message for both the failing first attempt and, if it also fails, the final
  attempt, so the room's log shows the exact real sequence rather than a single opaque
  `queue_failed`. Live-verified against a real, guaranteed-to-fail `youtube.com` URL.
- **Found live, not a code bug: the root domain wasn't actually unified.** Founder real-time,
  "it still doesnt work not unified ensure deploy" -- the DEPLOY was fine (the server was running
  the latest code, verified), but `mixforge.okemily.com/` still served the original standalone
  `room.wasm` compiler-pipeline proof as `index.html`, with `room.html` merely one of three links
  buried below it -- a real UX gap, not a bug in anything shipped so far. Fixed: that original
  proof page moved to `web/wasm-proof.html` (preserved as-is, still linked from `room.html`),
  `index.html` is now a plain redirect straight to `room.html`, so the bare domain IS the real,
  unified room with no extra click.

### Kanban items this resolves

Closes the open triage question in `T48839675`/`T94858758` (both: "resolve room-engine
architecture question... before Phase 5 scoping starts" / "scope `stdlib/media/stream.prn`") —
the real resolution is that Phase 5 doesn't need `media/stream.prn` at all; `T46478755`'s own real
room server already shipped. None of these needed the room-engine-vs-SHANKPIT-OS-app question
re-litigated — that was already answered 2026-09-22 ("build it with parena wasm").

## Golden doc registration

Registered in `EMILY/context/golden-docs-index.md` as `MIXFORGE-NORTH` per S205-101's own
explicit ask.
