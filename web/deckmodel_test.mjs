// deckmodel_test.mjs -- the deck list rules from the design: two decks to start, queueing adds
// decks up to four, "Load now" overrides a chosen deck, finished decks disappear.
import * as M from "./deckmodel.mjs";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
const song = (title, dur = 200) => ({ kind: "yt", title, artist: "A", dur, bpm: 120 });
// queue a song the way dj.html does: plan, reserve, then (later) fulfill
function queue(m, title, dur) {
  const p = M.plan(m); const d = M.reserve(m, p);
  return d ? { id: d.id, res: M.fulfill(m, d.id, song(title, dur)) } : null;
}
const ids = (m) => M.ordered(m).map((d) => d.id).join();
const st = (m) => M.ordered(m).map((d) => d.status[0]).join("");

console.log("start + queue");
{
  const m = M.createModel();
  check("two empty decks to start", ids(m) === "1,2" && st(m) === "ee");
  const a = queue(m, "A");
  check("first song fills Deck 1 and is the head", a.id === 1 && a.res.wasHead && M.headId(m) === 1);
  const b = queue(m, "B");
  check("second fills Deck 2, waits", b.id === 2 && !b.res.wasHead);
  check("third adds Deck 3", M.plan(m).create && queue(m, "C").id === 3 && m.decks.length === 3);
  check("fourth adds Deck 4", queue(m, "D").id === 4 && m.decks.length === 4);
  check("fifth has nowhere to go", M.plan(m) === null && M.isFull(m) && /All four decks/.test(M.hint(m)));
  check("play order is queue order", M.loadedOrder(m).map((d) => d.title).join("") === "ABCD");
}

console.log("describe");
{
  const m = M.createModel(); queue(m, "A", 100); queue(m, "B", 200); queue(m, "C", 300);
  const rows = M.describe(m, 40);
  check("position labels", rows.map((r) => r.pos).join() === "Now playing,Up next,Then");
  check("head hands off to next, with style", rows[0].foot === "Hands off to Deck 2 · blend 4s" && rows[0].canSkip && !rows[0].canRemove);
  check("waiting decks count down the whole chain", rows[1].foot === "Plays after Deck 1 · in 0:40" && rows[2].foot === "Plays after Deck 2 · in 4:00");
  m.handoff = "cut";
  check("cut shows as cut", /· cut$/.test(M.describe(m)[0].foot));
  const solo = M.createModel(); queue(solo, "A");
  check("a lone deck says it loops", M.describe(solo)[0].foot === "Loops until another deck joins" && !M.describe(solo)[0].canSkip);
}

console.log("load now");
{
  const m = M.createModel(); queue(m, "A"); queue(m, "B"); queue(m, "C");
  m.mode = "now"; m.target = 2;
  const p = M.plan(m);
  check("targets the chosen deck, replacing, order kept", p.id === 2 && p.replacing && !p.head);
  const d = M.reserve(m, p);
  check("old track stays loaded while the new one fetches", d.status === "loaded" && d.pending);
  const ticketBefore = d.ticket;
  const r = M.fulfill(m, 2, song("B2"));
  check("replacement keeps its place in line", r.deck.title === "B2" && r.deck.ticket === ticketBefore && !r.firstLoad && ids(m) === "1,2,3");
  m.target = 1;
  check("targeting the playing deck says so", M.plan(m).head && /Replaces the track playing now/.test(M.hint(m)));
  m.target = 4; // empty? no deck 4 -> falls back to the first deck
  check("a stale target falls back to the first deck", M.targetDeck(m).id === 1);
  const e = M.createModel(); e.mode = "now"; e.target = 2;
  check("hint on an empty rig says it starts right away", /Loads into empty Deck 2 and starts right away/.test(M.hint(e)));
  M.reserve(e, M.plan(e)); const f = M.fulfill(e, 2, song("X"));
  check("load-now into an empty deck on an empty rig makes it the head", f.wasHead && f.wasEmptyRig && M.headId(e) === 2);
}

console.log("hand-off, skip, remove");
{
  const m = M.createModel(); queue(m, "A"); queue(m, "B"); queue(m, "C");
  M.finish(m, 1);
  check("finished deck disappears; next takes over, ids stay", ids(m) === "2,3" && M.headId(m) === 2 && m.decks.length === 2);
  M.finish(m, 2);
  check("never fewer than two deck slots", m.decks.length === 2 && M.headId(m) === 3 && ids(m) === "3,1");
  check("an emptied slot is free for the next song", queue(m, "D").id === 1 && M.loadedOrder(m).map((d) => d.title).join("") === "CD");
  check("the playing deck can't be removed", !M.remove(m, 3) && M.headId(m) === 3);
  const n = M.createModel(); queue(n, "A"); queue(n, "B");
  check("a waiting deck can be removed", M.remove(n, 2) && M.headId(n) === 1 && n.decks.length === 2 && M.ordered(n)[1].status === "empty");
  check("add deck up to four, then stop", (M.addDeck(n), M.addDeck(n), n.decks.length === 4) && M.addDeck(n) === null);
}

console.log("failures");
{
  const m = M.createModel(); queue(m, "A"); queue(m, "B");
  const d = M.reserve(m, M.plan(m)); // adds Deck 3
  check("queueing past two creates the deck while fetching", d.id === 3 && d.created && M.describe(m).pop().pos === "Fetching");
  M.fail(m, 3);
  check("a failed fetch removes the deck it created", m.decks.length === 2);
  const m2 = M.createModel(); M.reserve(m2, M.plan(m2)); M.fail(m2, 1);
  check("a failed fetch empties an empty slot again", M.deckById(m2, 1).status === "empty" && m2.decks.length === 2);
  const m3 = M.createModel(); queue(m3, "A"); m3.mode = "now"; M.reserve(m3, M.plan(m3)); M.fail(m3, 1);
  check("a failed replacement keeps the old track", M.deckById(m3, 1).title === "A" && !M.deckById(m3, 1).pending);
}

console.log(`\ndeckmodel_test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
