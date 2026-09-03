# Changelog

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
