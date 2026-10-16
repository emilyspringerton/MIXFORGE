// deckmodel.mjs -- the single-player deck list as plain data: which slots exist, what is in them,
// and the play order. No DOM, no audio -- dj.html renders it and mirrors it into the engine, and
// deckmodel_test.mjs runs it under Node. The rules are the design's: every queued song becomes its
// own deck (two to start, up to four), a "Load now" overrides a specific deck, and when a track
// finishes its deck disappears and the next one takes over.
//
// Deck ids are 1..4 and permanent for as long as a deck exists (engine deck index = id - 1). The
// play order is by `ticket`, handed out when a deck's audio arrives; the engine keeps the same
// tickets, so both sides agree on "now playing" without trading whole lists.
export const MAX_DECKS = 4;
export const MIN_DECKS = 2;
export const POS_LABELS = ["Now playing", "Up next", "Then", "Later"];

export function createModel() {
  return {
    decks: [blank(1), blank(2)],
    mode: "queue", // "queue" adds a deck behind the others; "now" overrides the target deck
    target: 1,
    handoff: "blend", // "blend" | "cut"
    ticket: 0,
    rid: 0,
  };
}

function blank(id) {
  return { id, status: "empty", kind: "", title: "", artist: "", dur: 0, bpm: 0, ticket: null, rid: 0, pending: false, created: false };
}

const byTicket = (a, b) => a.ticket - b.ticket;
const byRid = (a, b) => a.rid - b.rid;

// display order: loaded decks in play order, then decks still fetching, then empty slots
export function ordered(m) {
  const loaded = m.decks.filter((d) => d.status === "loaded").sort(byTicket);
  const fetching = m.decks.filter((d) => d.status === "fetching").sort(byRid);
  const empty = m.decks.filter((d) => d.status === "empty").sort((a, b) => a.id - b.id);
  return [...loaded, ...fetching, ...empty];
}
export const loadedOrder = (m) => m.decks.filter((d) => d.status === "loaded").sort(byTicket);
export const deckById = (m, id) => m.decks.find((d) => d.id === id) || null;
export const headId = (m) => { const h = loadedOrder(m)[0]; return h ? h.id : 0; };

function freeId(m) {
  for (let i = 1; i <= MAX_DECKS; i++) if (!m.decks.some((d) => d.id === i)) return i;
  return 0;
}
export const canAddDeck = (m) => m.decks.length < MAX_DECKS;
export const isFull = (m) => m.decks.length >= MAX_DECKS && m.decks.every((d) => d.status !== "empty");

export function addDeck(m) {
  if (!canAddDeck(m)) return null;
  const d = blank(freeId(m));
  m.decks.push(d);
  return d;
}

export function targetDeck(m) {
  return deckById(m, m.target) || ordered(m)[0];
}

// plan -- where a new song would go, without changing anything. null = nowhere (queue mode, full).
export function plan(m) {
  if (m.mode === "now") {
    const t = targetDeck(m);
    return t ? { id: t.id, replacing: t.status !== "empty", create: false, head: t.id === headId(m) || headId(m) === 0 } : null;
  }
  const slot = ordered(m).find((d) => d.status === "empty");
  if (slot) return { id: slot.id, replacing: false, create: false, head: headId(m) === 0 };
  if (canAddDeck(m)) return { id: freeId(m), replacing: false, create: true, head: headId(m) === 0 };
  return null;
}

// reserve -- claim the planned deck while its audio is fetching. Returns the deck, or null.
export function reserve(m, p) {
  if (!p) return null;
  let d = deckById(m, p.id);
  if (!d) { d = blank(p.id); d.created = true; m.decks.push(d); }
  d.rid = ++m.rid;
  if (d.status === "loaded") d.pending = true; // keep the old track running until the new one lands
  else { d.status = "fetching"; d.title = ""; d.artist = ""; }
  return d;
}

// fulfill -- the audio arrived. Returns { deck, wasHead, firstLoad }: wasHead = the deck is now
// the one playing (so the host should start it), firstLoad = it got a fresh ticket (new to the chain).
export function fulfill(m, id, track) {
  const d = deckById(m, id);
  if (!d) return null;
  const hadTicket = d.ticket !== null;
  const wasEmptyRig = loadedOrder(m).length === 0;
  Object.assign(d, { kind: track.kind, title: track.title, artist: track.artist, dur: track.dur, bpm: track.bpm || 0, status: "loaded", pending: false, created: false });
  if (!hadTicket) d.ticket = ++m.ticket;
  return { deck: d, wasHead: headId(m) === d.id, firstLoad: !hadTicket, wasEmptyRig };
}

// fail -- the fetch died. A deck that only existed for this song goes away; a loaded deck keeps its
// old track; an empty slot goes back to empty.
export function fail(m, id) {
  const d = deckById(m, id);
  if (!d) return;
  if (d.status === "loaded") { d.pending = false; return; }
  if (d.created) { m.decks = m.decks.filter((x) => x !== d); return; }
  Object.assign(d, blank(d.id));
}

function removeDeck(m, id) {
  m.decks = m.decks.filter((d) => d.id !== id);
  while (m.decks.length < MIN_DECKS) { const f = freeId(m); if (!f) break; m.decks.push(blank(f)); }
  if (!deckById(m, m.target)) m.target = (ordered(m)[0] || { id: 1 }).id;
}

// remove -- the X on a waiting or empty deck. The playing deck can't be removed (skip it instead).
export function remove(m, id) {
  const d = deckById(m, id);
  if (!d || id === headId(m)) return false;
  removeDeck(m, id);
  return true;
}

// finish -- the engine handed off: the outgoing deck disappears.
export function finish(m, id) { removeDeck(m, id); }

export const canSkip = (m) => loadedOrder(m).length > 1;

// describe -- everything the cards say, derived. headRemain = seconds left on the playing deck.
export function describe(m, headRemain = 0) {
  const loaded = loadedOrder(m);
  const handLabel = m.handoff === "blend" ? "blend 4s" : "cut";
  const rows = ordered(m).map((d) => {
    const order = loaded.indexOf(d);
    const row = { id: d.id, status: d.status, pending: d.pending, order, isNow: order === 0, hasOthers: loaded.length > 1 };
    if (d.status === "empty") return { ...row, pos: "Empty", foot: "", canRemove: true, canSkip: false };
    if (d.status === "fetching") return { ...row, pos: "Fetching", foot: "Downloading audio from YouTube", canRemove: true, canSkip: false };
    let wait = 0;
    if (order > 0) {
      wait = headRemain;
      for (let k = 1; k < order; k++) wait += loaded[k].dur;
    }
    let foot;
    if (order === 0 && loaded.length > 1) foot = `Hands off to Deck ${loaded[1].id} · ${handLabel}`;
    else if (order === 0) foot = "Loops until another deck joins";
    else foot = `Plays after Deck ${loaded[order - 1].id} · in ${fmt(wait)}`;
    return { ...row, pos: POS_LABELS[order] || "Later", foot, wait, canRemove: order > 0, canSkip: order === 0 && loaded.length > 1 };
  });
  return rows;
}

// hint -- the one line under the composer that says what the next song will do.
export function hint(m) {
  const loaded = loadedOrder(m);
  if (m.mode === "queue") {
    const p = plan(m);
    if (!p) return "All four decks are in use. Skip or remove one to queue more.";
    const last = ordered(m).filter((d) => d.status !== "empty").pop();
    const verb = p.create ? `Adds Deck ${p.id}` : `Fills empty Deck ${p.id}`;
    return last ? `${verb} and plays it after Deck ${last.id}.` : `${verb} and starts right away.`;
  }
  const t = targetDeck(m);
  if (!t) return "";
  if (t.status === "empty") return `Loads into empty Deck ${t.id}${loaded.length ? "" : " and starts right away"}.`;
  if (t.id === headId(m)) return "Replaces the track playing now, starting right away.";
  return `Replaces Deck ${t.id} immediately. Play order stays the same.`;
}

export function fmt(s) {
  s = Math.max(0, Math.round(s));
  return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}
