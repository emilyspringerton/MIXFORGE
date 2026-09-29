// Shared engine-boot boilerplate: instantiate dsp.wasm, stand up the AudioWorklet, wire its
// message port. Identical between every MIXFORGE page that hosts the 4-deck mixer -- what differs
// per page (which decks get demo loops, whether a deck waits on a multiplayer room) stays in the
// page's own script, passed in as the on* callbacks.
import { instantiateDsp } from "./engine.mjs";

export async function bootEngine({ onState, onCaptured, onMidiEvent }) {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  const wasm = await (await fetch("dsp.wasm")).arrayBuffer();
  const dsp = instantiateDsp(wasm);
  await ctx.audioWorklet.addModule("dsp-worklet.js");
  const node = new AudioWorkletNode(ctx, "mixforge-processor", { outputChannelCount: [2], processorOptions: { wasm } });
  node.connect(ctx.destination);
  // Fan-out for the mix recorder (web/recorder.mjs, S513): a MediaStreamAudioDestinationNode
  // tapped straight off the same worklet output that reaches the speakers, so a recording can
  // never drift from what the DJ actually heard.
  const recordDest = ctx.createMediaStreamDestination();
  node.connect(recordDest);
  node.port.onmessage = (ev) => {
    const m = ev.data;
    if (m.type === "state") onState(m.state);
    else if (m.type === "captured") onCaptured(m);
    else if (m.type === "midiEvent") onMidiEvent(m.event);
  };
  function send(m, transfer) { node.port.postMessage(m, transfer || []); }
  return { ctx, dsp, node, send, recordStream: recordDest.stream };
}
