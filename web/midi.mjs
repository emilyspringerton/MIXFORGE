// Shared Web MIDI input wiring: device enumeration/hot-plug, binding the selected input, and
// forwarding raw MIDI bytes. Page owns what happens with a message (send to the worklet, flash a
// pad) via the callbacks.
export function createMidiHandler({ onMessage, onNoteOn, statusEl, selectEl }) {
  let midiAccess = null, midiInput = null;

  function bind(id) {
    if (midiInput) midiInput.onmidimessage = null;
    midiInput = id ? midiAccess.inputs.get(id) : null;
    if (midiInput) midiInput.onmidimessage = (ev) => {
      const [s, d1, d2] = ev.data;
      if (s >= 0xf0) return; // clock/sysex: not handled yet
      onMessage([s, d1, d2]);
      if ((s & 0xf0) === 0x90 && d2 > 0) onNoteOn(d1);
    };
  }

  async function init() {
    if (!navigator.requestMIDIAccess) { statusEl.textContent = "Web MIDI not supported in this browser (pads + keyboard still work)"; return; }
    try {
      midiAccess = await navigator.requestMIDIAccess();
    } catch (err) {
      statusEl.textContent = "MIDI access denied"; return;
    }
    const refresh = () => {
      const prev = selectEl.value;
      selectEl.innerHTML = `<option value="">(none)</option>`;
      for (const inp of midiAccess.inputs.values()) {
        const o = document.createElement("option"); o.value = inp.id; o.textContent = inp.name; selectEl.appendChild(o);
      }
      if ([...midiAccess.inputs.keys()].includes(prev)) selectEl.value = prev;
      else if (midiAccess.inputs.size) { selectEl.value = [...midiAccess.inputs.keys()][0]; bind(selectEl.value); }
      statusEl.textContent = `${midiAccess.inputs.size} MIDI input(s)`;
    };
    midiAccess.onstatechange = refresh;
    refresh();
  }
  selectEl.addEventListener("change", (e) => bind(e.target.value));

  return { init };
}
