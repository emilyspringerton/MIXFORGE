# MIXFORGE

## What this is

A real-time DJ mixing application, built PARENA-native — the flagship consumer of PARENA's own
`media/audio`/`media/codec`/`media/stream` stdlib domains (`PARENA/STDLIB.md` §26-28), the same
"dogfood the language" discipline PITVIPER/DUNG/SAND already commit to elsewhere in this
monorepo. **Read `NORTHSTAR.md` before writing any code** — it has the full real scoping pass,
the real current blocker (the stdlib layer this depends on doesn't exist as code yet, design
only), and the phased plan.

## Status

New repo (2026-09-03), NORTHSTAR only. `legacy.txt` is the real source conversation (a captured
AI chat transcript that reached a real, concrete C++/JUCE/Essentia/RubberBand/yt-dlp design,
explicitly rejected here in favor of PARENA — see `NORTHSTAR.md`'s own stack-decision table).
No code written yet — Phase 1 (YouTube import + track library, the transcript's own real first
feature) is the actual starting point, not Phase 0's `media/audio` work, since Phase 1 only
needs `stdlib/shell.prn` (already real) plus a sqlite FFI binding.

## Real, current dependency (checked directly, not assumed)

`PARENA/stdlib/media/` does not exist yet — `STDLIB.md` §26-28 is a resolved API-surface design
(FFI-bind real libraries) but zero `.prn` implementation. MIXFORGE's own Phase 1 (two-deck
crossfade) cannot start until that lands. See `NORTHSTAR.md`'s own "Real, current blocker"
section for the full detail.

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
