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

Where the code lives: the DSP kernels are `PARENA/stdlib/mixforge/mixer.prn` and `sampler.prn`,
built into `web/dsp.wasm`. `web/engine.mjs` is the host (buffers, voice slots, the frame loop —
the parts PARENA's scalar-only WASM target can't express yet) and calls into `dsp.wasm` for every
decision. `web/dsp-worklet.js` runs it on the audio thread (AudioWorklet).

**Multiplayer DJ room: `server/room_server.mjs` + `web/multiplayer.html`** (working, no audio sync)
— seat occupancy, join/leave, whose-turn broadcast; turn order from PARENA (`web/room.wasm`).

**Track import CLI: `src/main.c`** (working) — `mixforge import <youtube-url> [instrumental-url]`
downloads via `yt-dlp` into `tracks/main/`, `tracks/instrumental/`, appends to `tracks/library.ndjson`.

## Run it

```bash
# needs a sibling ../PARENA checkout (cd ../PARENA && make build) and llc + wasm-ld (LLVM 18)
./scripts/build_dsp_wasm.sh        # builds web/dsp.wasm, runs web/dsp_test.mjs (49 checks)
cd web && python3 -m http.server 8000
# open http://localhost:8000/dj.html, click "Start audio", press "Play all 4"
node web/render_demo.mjs out.wav   # offline: renders a scripted 47s set through the same engine
```

`web/dsp.wasm` is checked in, so the page runs without rebuilding. Room server: `cd server &&
npm install && npm start`, then open `web/multiplayer.html` in a few tabs.

## Live

`mixforge.okemily.com` — real, deployed: `web/dj.html` and `web/multiplayer.html` served
straight from this repo checkout, `/ws` proxied to the real, running `server/room_server.mjs`
(loopback-only; nginx is the real gate, same split `jewel-jupyter.service` uses elsewhere in
this monorepo). See `ops/nginx/mixforge-okemily.conf` + `ops/systemd/mixforge-room-server.service`
for the exact config, `IDUNA/ops/terraform/main.tf`'s `cloudflare_dns_record.mixforge` for DNS,
and `sudo-queue/92-mixforge-okemily-domain.sh` for the deploy script.

## Status and limits

- Verified: `web/dsp_test.mjs` — kernel accuracy against `Math` references, plus rendered-audio
  checks (a Goertzel detector measures which frequencies are really in the output) for mute,
  solo, crossfader, pan, filter, pitch, MIDI CC, pads, chromatic pitch, bend, note-off, velocity,
  beat-synced capture and the soft clipper. `PARENA`'s `make test-mixforge-dsp` checks the same
  kernels on the native C target. The page itself was driven headlessly in Chromium (no console
  errors, meters move, pads fire, captures land). **Not yet tried with a physical MIDI controller.**
- No BPM or key detection yet: BPM is typed in (demo loops know theirs). Pitch fader is
  varispeed — no keylock/time-stretch (NORTHSTAR Phase 4).
- The room and the mixer are not connected yet: nothing is synchronized between listeners.
- Linear interpolation for resampling (audible aliasing on big pitch-downs of bright material).
