# MIXFORGE

## What this is

A real-time DJ mixing application, built PARENA-native — the flagship consumer of PARENA's own
`media/audio`/`media/codec`/`media/stream` stdlib domains (`PARENA/STDLIB.md` §26-28), the same
"dogfood the language" discipline PITVIPER/DUNG/SAND already commit to elsewhere in this
monorepo. **Read `NORTHSTAR.md` before writing any code** — it has the full real scoping pass,
the real current blocker (the stdlib layer this depends on doesn't exist as code yet, design
only), and the phased plan.

## Status

`legacy.txt` is the real source conversation (a captured AI chat transcript that reached a real,
concrete C++/JUCE/Essentia/RubberBand/yt-dlp design, explicitly rejected here in favor of PARENA
— see `NORTHSTAR.md`'s own stack-decision table). **Real V0 code shipped 2026-09-03 (S243-01)**:
`PARENA/stdlib/mixforge/import.prn` — paste a YouTube URL (plus an optional instrumental URL),
shells out to real `yt-dlp` via `process/run-capture`, real layered shell-injection defense,
live-verified (`make test-mixforge-import` in PARENA). **Real CLI shipped 2026-09-04
(MF-CORE-12441)**: `src/main.c`, this repo's own first real code — `mixforge import <url>
[instrumental-url]`, creates the real `tracks/main/`/`tracks/instrumental/` directories, calls
the real, generated `import_track` (committed at `generated/mixforge_gen.c`), and appends a real
NDJSON line to `tracks/library.ndjson`. Live-verified with the same yt-dlp-stub technique
`test_mixforge_import.c` established. Still open, honestly named: metadata lands as NDJSON
rather than a queryable SQLite store, playback/mixing now works in the browser (see below), while key/BPM detection is
still blocked on real, separate PARENA-side work that doesn't exist yet — see `NORTHSTAR.md`'s
own "In scope (V0)" section for the exact remaining slice.

## Real, current dependency (checked directly, not assumed)

**Updated 2026-09-27**: real 4-deck mixing + a 16-pad MIDI sampler now exist in the browser
(`web/dj.html`) without waiting on `PARENA/stdlib/media/` — the DSP kernels are PARENA
(`stdlib/mixforge/mixer.prn`, `sampler.prn`) compiled to `web/dsp.wasm` via
`scripts/build_dsp_wasm.sh`, and the browser's Web Audio API is the audio I/O. `stdlib/media/`
(still design-only) is only needed now for a native, non-browser playback path. Rebuild
`web/dsp.wasm` whenever either `.prn` changes; `web/dsp_test.mjs` must pass (the build script
runs it). The LLVM->WASM backend is scalar-only with `if` lowered to `select` (both branches
evaluated): keep kernels non-recursive and total. See `README.md` for what works and its limits.

## Related Repos

- `PARENA` — the language and stdlib (`media/audio`/`codec`/`stream`) this repo is built on;
  most of the real near-term work actually happens there, not here.
- `PITVIPER` — `pitviper/quicklook` (`STDLIB.md` line 95) shares the same `media/codec`/`media/
  audio` dependency; relationship not decided (`NORTHSTAR.md` open question 3).
- `EMILY` — RSI loop / backlog coordination for cross-repo work.

## Founder Real-Time Direction

Whenever the founder gives real-time direction — a new ask, a correction, a "can we also..." —
route it through `emily observe -s info "Founder real-time: <summary>"` first, even if it isn't
this repo's usual domain, then sprint-plan it into `EMILY/BACKLOG.md` (`emily backlog curate`,
scoped into a real SECTION/sub-item, not just a one-line log), and only then implement. See
`EMILY/docs/THE_EMILY_WAY.md` Principle 18 ("Pave the Cow Paths").

## Apple Filing Protocol

After any meaningful change, file an Apple:
```bash
emily apples post -t completion -repo MIXFORGE "<title>" "<body with commit hash>"
```
Then mark the item done in `EMILY/BACKLOG.md` and commit.

## CHANGELOG Protocol

After any meaningful change, update CHANGELOG.md:
```bash
emily changelog add MIXFORGE "<what changed>"
# or manually: append a dated bullet under ## YYYY-MM-DD in MIXFORGE/CHANGELOG.md
```

## Golden Doc Registration

If you create a new NORTHSTAR.md, architecture spec, or mission-critical design doc in this repo,
append a row to `EMILY/context/golden-docs-index.md` so Emily Prime picks it up on the next cycle.
Then commit and push EMILY.

## README Reality — SAGA reconciliation (standing instruction, monorepo-wide)

Founder real-time, 2026-09-18: if a change of yours **substantially changes the claim of this project's core README**,
then per SAGA protocols (`EMILY/docs/SAGA_SYSTEM_AUDIT_2026-07-18.md`, HQ-SPEC-DOC-102: intent ↔ claim ledger ↔ reality)
you **must update `README.md` in the same unit of work** so it reflects current reality. The README is the project's public
claim; it must not lag behind the code.

- **When it applies:** a capability is added or removed; status moves ("design only" → "working", "planned" → "shipped");
  the stack, build, run or install steps change; a claim in the README is now false or stale; or you add a **meaningful,
  genuinely interesting piece of kit** (a new tool, engine capability, protocol, pipeline, game system). For that last case
  especially: put it in the README — what it is, how to run it, and its honest status and limits.
- **When it does not:** ordinary fixes, refactors and small features that leave the README's claims true.
- **How:** re-read the README against what you just changed; fix or delete stale lines (including "not built yet" notes that
  are now built); verify any new claim by actually running it, and mark anything untested as untested; commit the README
  with (or immediately after) the change, and mention it in the CHANGELOG entry.

## Frame-Break Reframing

Founder-sourced prompting technique (REDGARDEN/NORTHSTAR.md §28, full origin in
REDGARDEN/docs2/MULTI_AGENT_RD_RESEARCH_NOTES.md §5): given a request, name the underlying
structural/systemic pattern it's one instance of — one level of abstraction up — as an added
lens during planning/triage/judgment calls. Use it to spot the general case behind a specific
ask. It augments judgment, it does not replace doing the work: direct, concrete execution of
the literal task asked for still happens every time.

## Commit Protocol (standing instruction)

Always commit and push completed work immediately — don't wait to be asked. This is the default for every repo in this monorepo.

Every commit — human-written or produced by automated code paths (git-commit helpers in emily-agent, emily.cli, IDUNA handlers, etc.) — must carry the active `emily session` fingerprint as a `session: <tag>` trailer (blank line, then the trailer). This was silently missing from several independently-implemented automated commit helpers across the monorepo until an audit on 2026-08-10 (founder, real-time: "where in the fuck is my llm session id anywhere"). If you add a new automated git-commit code path anywhere, wire in the session tag the same way — don't assume an existing helper already does it.

## Core Deps Are PARENA-First (standing, monorepo-wide)

Founder real-time, 2026-10-01: *"always implement core deps in PARENA — when core deps are missing
always implement the core deps in PARENA first."*

- **When a core dependency is missing** (a codec, a protocol client, an inference engine, a
  parser, a data structure — anything this repo's own functionality stands on), implement it in
  PARENA (`PARENA/stdlib/...`) **first**, before building the feature that needs it. Deps first,
  feature second.
- **If PARENA itself can't express the dep yet**, that gap is the real first task: fix or extend
  PARENA (compiler, emitter, or stdlib), with tests, then build the dep on top. Don't route around it.
- **Third-party tools/binaries are stopgaps, not the answer.** Shelling out to or FFI-binding an
  existing tool is allowed only to unblock a demo, and must be labeled as a stopgap in the code and
  in `EMILY/BACKLOG.md` with a PARENA replacement item. (Example: Piper via subprocess for
  MODE_TYLER TTS, 2026-10-01 — stopgap; the PARENA-native synthesis stack is the real work.)
- **Not a license to reimplement the OS.** Core deps = what the product's own behavior depends on.
  Compilers, kernels, system libraries and the like stay as-is; a repo's own CLAUDE.md may record a
  considered, specific exception (same standard as the LZ4 compression convention).
