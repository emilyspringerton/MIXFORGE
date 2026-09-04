# Changelog

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
