// Shared 16-pad MIDI sampler component: pad grid, capture controls (sample N beats from any deck
// into a pad), keyboard bindings, chromatic-pad selection. Identical logic wherever MIXFORGE hosts
// the sampler -- pages differ only in which decks they offer to sample from (deckLabels).
const KEYS = "1234qwerasdfzxcv";
const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
export const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

export function createSampler({ send, log, deckState, PADS, deckLabels }) {
  const $ = (s, el = document) => el.querySelector(s);
  const padsEl = $("#pads");
  const padNames = Array(PADS).fill("");
  let chromPad = 4;

  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const j = r * 4 + c;
      const el = document.createElement("div");
      el.className = "pad";
      el.dataset.pad = j;
      el.innerHTML = `<b>${j + 1}</b><span class="pn"></span><kbd>${KEYS[j].toUpperCase()} · ${noteName(36 + j)}</kbd>`;
      const down = (e) => { e.preventDefault(); noteOn(36 + j, 110); };
      const up = () => noteOff(36 + j);
      el.addEventListener("pointerdown", down);
      el.addEventListener("pointerup", up);
      el.addEventListener("pointerleave", up);
      padsEl.appendChild(el);
      for (const sel of ["#capPad", "#chromPad"]) {
        const o = document.createElement("option"); o.value = j; o.textContent = `pad ${j + 1}`; $(sel).appendChild(o);
      }
    }
  }

  const capDeckSel = $("#capDeck");
  capDeckSel.innerHTML = deckLabels.map((label, i) => `<option value="${i}">${label}</option>`).join("");

  $("#capPad").value = 5;
  $("#chromPad").value = chromPad;
  $("#chromPad").addEventListener("change", (e) => { chromPad = +e.target.value; send({ type: "global", key: "chromaticPad", value: chromPad }); renderPads(); });
  $("#samplerGain").addEventListener("input", (e) => { e.target.nextElementSibling.textContent = (+e.target.value).toFixed(2); send({ type: "global", key: "samplerGain", value: +e.target.value }); });
  $("#capGo").addEventListener("click", () => {
    const deck = +capDeckSel.value;
    if (!deckState[deck].bpm) log(`sample: deck ${deck + 1} has no BPM set — capture-frames falls back to 120`);
    send({ type: "capture", j: +$("#capPad").value, deck, beats: +$("#capBeats").value });
  });

  function renderPads(state) {
    padsEl.querySelectorAll(".pad").forEach((el) => {
      const j = +el.dataset.pad;
      if (state) padNames[j] = state.pads[j].len ? state.pads[j].name : "";
      $(".pn", el).textContent = padNames[j];
      el.classList.toggle("loaded", !!padNames[j]);
      el.classList.toggle("chrom", j === chromPad);
    });
  }
  function flashPad(note) {
    const j = note - 36;
    const el = padsEl.querySelector(`[data-pad="${j}"]`);
    if (!el) return;
    el.classList.add("hit");
    setTimeout(() => el.classList.remove("hit"), 110);
  }
  function noteOn(note, vel, ch = 0) { send({ type: "midi", data: [0x90 | ch, note, vel] }); flashPad(note); }
  function noteOff(note, ch = 0) { send({ type: "midi", data: [0x80 | ch, note, 0] }); }

  const held = new Set();
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT" || e.repeat) return;
    const j = KEYS.indexOf(e.key.toLowerCase());
    if (j >= 0) { held.add(j); noteOn(36 + j, e.shiftKey ? 60 : 110); }
  });
  window.addEventListener("keyup", (e) => {
    const j = KEYS.indexOf(e.key.toLowerCase());
    if (j >= 0 && held.delete(j)) noteOff(36 + j);
  });

  renderPads();
  return { renderPads, flashPad, noteOn, noteOff, getChromPad: () => chromPad };
}
