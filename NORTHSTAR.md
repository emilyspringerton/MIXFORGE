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

**No code shipped from this addendum** — same "scope first" standing every phase of this doc
already follows. Real, concrete next step once directed: Phase 5 (`media/stream.prn`) scoping,
since it's now the real gating dependency for the room concept, ahead of Phases 3-4.

## Golden doc registration

Registered in `EMILY/context/golden-docs-index.md` as `MIXFORGE-NORTH` per S205-101's own
explicit ask.
