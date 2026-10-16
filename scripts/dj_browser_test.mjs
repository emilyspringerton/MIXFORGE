// dj_browser_test.mjs -- drives the real single-player page (web/dj.html) in headless Chromium
// against the real room server, with yt-dlp stubbed (no network, no YouTube): the stub "downloads"
// a generated WAV whose length comes from the video id (`s20` = 20 seconds), so the whole
// queue -> hand-off -> disappear story runs in about a minute.
//
//   NODE_PATH=<dir with playwright installed> PLAYWRIGHT_BROWSERS_PATH=<browsers dir> \
//     node scripts/dj_browser_test.mjs <screenshot-dir>
//
// playwright is not a repo dependency (like WOTAN's browser tests, it is installed ad hoc).
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "../server/room_server.mjs";

// createRequire (not import) so NODE_PATH finds the ad-hoc playwright install
const { chromium } = createRequire(import.meta.url)("playwright");

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, "..", "web");
const OUT = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), "dj-shots-"));
fs.mkdirSync(OUT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dj-cache-"));

// ---- stub yt-dlp: id "s8" -> 8s tone; "boom" -> the bot-check failure --------------------------------
function wav(freq, secs, sr = 44100) {
  const n = Math.floor(sr * secs), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let k = 0; k < n; k++) {
    const t = k / sr, beat = (t * 2) % 1; // a 120 BPM pulse so the BPM estimator has something to find
    const env = Math.exp(-beat * 6);
    buf.writeInt16LE(Math.round(Math.sin(2 * Math.PI * freq * t) * 0.6 * env * 32767), 44 + k * 2);
  }
  return buf;
}
let dl = 0;
async function stubDownload(url) {
  if (url.includes("boom")) return { ok: false, error: "ERROR: Sign in to confirm you're not a bot" };
  const id = new URL(url).pathname.split("/").pop() || new URL(url).searchParams.get("v");
  const secs = Number((/^s(\d+)/.exec(id) || [])[1] || 8);
  await new Promise((r) => setTimeout(r, 300));
  const file = path.join(TMP, `${++dl}-${id}.wav`);
  fs.writeFileSync(file, wav(220 + 55 * dl, secs));
  return { ok: true, path: file, title: `Song ${id}`, artist: `Artist ${dl}` };
}

// ---- server: static web/ + /room-cache from TMP + /ws piped to the real room server --------------------
const WSPORT = 8981;
const rs = startServer(WSPORT, "127.0.0.1", stubDownload, 60000);
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".wav": "audio/wav" };
const web = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = u.startsWith("/room-cache/") ? path.join(TMP, u.slice(12)) : path.join(WEB, u === "/" ? "dj.html" : u);
  if (!file.startsWith(WEB) && !file.startsWith(TMP) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
web.on("upgrade", (req, socket, head) => {
  const up = net.connect(WSPORT, "127.0.0.1", () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n") + "\r\n\r\n");
    if (head && head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on("error", () => socket.destroy()); socket.on("error", () => up.destroy());
});
await new Promise((r) => web.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${web.address().port}`;

// ---- checks ------------------------------------------------------------------------------------------
let passed = 0, failed = 0;
const check = (name, ok, detail = "") => { if (ok) { passed++; console.log(`  ok   ${name}`); } else { failed++; console.error(`  FAIL ${name} ${detail}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR/.test(m.text())) errors.push("console: " + m.text()); });

const deckIds = () => page.$$eval("#decks article", (a) => a.map((x) => +x.dataset.id));
const deck = (id) => `#decks article[data-id="${id}"]`;
const pill = (id) => page.textContent(`${deck(id)} .pill`);
const title = (id) => page.textContent(`${deck(id)} .title`).catch(() => null);
const foot = (id) => page.textContent(`${deck(id)} .foot-text`).catch(() => null);
const waitFor = (fn, ms = 20000, arg) => page.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);
async function queue(url, wait = true) {
  await page.fill("#url", url);
  await page.click("#go");
  if (wait) await sleep(1200);
}

await page.goto(BASE + "/dj.html");
await page.screenshot({ path: path.join(OUT, "00-start.png") });
await page.click("#start");
await page.waitForSelector("#overlay", { state: "detached" });
await sleep(300);

console.log("start state");
check("two empty decks, plus an open slot to add more", (await deckIds()).join() === "1,2" && (await page.$$("#decks .openslot")).length === 1);
check("slot counter reads 2 of 4", (await page.textContent("#slotText")) === "2 of 4 decks in use");
check("composer says what queueing will do", /Fills empty Deck 1 and starts right away/.test(await page.textContent("#hint")));
await page.screenshot({ path: path.join(OUT, "01-empty.png"), fullPage: true });

console.log("queue = deck");
await page.fill("#url", "https://youtu.be/s24");
await page.click("#go");
await sleep(80);
check("the deck shows it's fetching while the download runs", /Fetching/.test(await pill(1)) && (await page.$$(`${deck(1)} .spin`)).length === 1);
check("loaded into Deck 1, now playing", await waitFor(() => document.querySelector('#decks article[data-id="1"] .title')?.textContent === "Song s24", 8000));
check("first song is the head and starts by itself", /Now playing/.test(await pill(1)) && (await foot(1)) === "Loops until another deck joins");
await sleep(1200);
check("audio is really flowing (master meter moves)", (await page.$eval("#mL", (e) => parseFloat(e.style.width) || 0)) > 0.5);
check("BPM estimate lands on the deck", await waitFor(() => +document.querySelector('#decks article[data-id="1"] .bpm-in')?.value > 0, 5000));

await queue("https://youtu.be/s20");
check("second song becomes Deck 2, up next", (await deckIds()).join() === "1,2" && /Up next/.test(await pill(2)) && (await title(2)) === "Song s20");
check("hand-off text on the playing deck", (await foot(1)) === "Hands off to Deck 2 · blend 4s");
check("waiting deck counts down", /^Plays after Deck 1 · in 0:\d\d$/.test(await foot(2)));
await queue("https://youtu.be/s20");
check("third song adds Deck 3 (Then)", (await deckIds()).join() === "1,2,3" && /Then/.test(await pill(3)));
await queue("https://youtu.be/s20");
check("fourth adds Deck 4 (Later); no open slot left", (await deckIds()).join() === "1,2,3,4" && (await page.$$("#decks .openslot")).length === 0 && /Later/.test(await pill(4)));
check("queue is full: button off, hint says so", (await page.$eval("#go", (b) => b.disabled)) && /All four decks are in use/.test(await page.textContent("#hint")));
await page.screenshot({ path: path.join(OUT, "02-four-decks.png"), fullPage: true });

console.log("load now (override)");
await page.click("#modeNow");
await page.click('#targets [data-target="3"]');
check("hint explains the override", /Replaces Deck 3 immediately/.test(await page.textContent("#hint")));
check("go button names the deck", /Load into Deck 3/.test(await page.textContent("#go")));
await page.screenshot({ path: path.join(OUT, "03-load-now.png"), clip: { x: 0, y: 0, width: 1440, height: 420 } });
const before3 = await title(3);
await queue("https://youtu.be/s12");
check("Deck 3 swapped in place, order unchanged", (await title(3)) === "Song s12" && before3 !== "Song s12" && (await deckIds()).join() === "1,2,3,4" && /Then/.test(await pill(3)));
check("the playing deck was not disturbed", /Now playing/.test(await pill(1)) && (await title(1)) === "Song s24");
await page.click("#modeQueue");

console.log("hand-off: blend, then the finished deck disappears");
const sawBlend = await waitFor(() => /Fading out/.test(document.querySelector('#decks article[data-id="1"] .pill')?.textContent || ""), 26000);
check("near the end Deck 1 fades out while Deck 2 fades in", sawBlend && /Fading in/.test(await pill(2)), `sawBlend=${sawBlend} deck2=${await pill(2).catch(() => "-")} deck1=${await pill(1).catch(() => "-")}`);
if (sawBlend) await page.screenshot({ path: path.join(OUT, "04-blending.png"), fullPage: true });
check("Deck 1 disappears when its track is done", await waitFor(() => !document.querySelector('#decks article[data-id="1"]'), 10000));
check("Deck 2 is now playing; the rest moved up", (await deckIds()).join() === "2,3,4" && /Now playing/.test(await pill(2)) && /Up next/.test(await pill(3)));
check("slot counter and open slot follow", (await page.textContent("#slotText")) === "3 of 4 decks in use" && (await page.$$("#decks .openslot")).length === 1);
check("queueing again reuses the freed slot id", /Adds Deck 1 and plays it after Deck 4/.test(await page.textContent("#hint")));
await page.screenshot({ path: path.join(OUT, "05-after-handoff.png"), fullPage: true });

console.log("skip, cut, remove");
await page.click(`${deck(2)} [data-act="skip"]`);
check("skip blends into the next deck now, then drops the old one", await waitFor(() => !document.querySelector('#decks article[data-id="2"]'), 8000) && /Now playing/.test(await pill(3)));
await page.click("#hoCut");
await page.click(`${deck(3)} [data-act="skip"]`);
check("with Cut, skip is immediate", await waitFor(() => !document.querySelector('#decks article[data-id="3"]'), 2000) && /Now playing/.test(await pill(4)));
check("a lone deck loops (no skip button)", (await page.$$(`${deck(4)} [data-act="skip"]`)).length === 0 && (await foot(4)) === "Loops until another deck joins");
await queue("https://youtu.be/s30");
await queue("https://youtu.be/s30");
const ids = await deckIds();
await page.click(`${deck(ids[ids.length - 1])} [data-act="remove"]`);
check("a waiting deck can be removed", (await deckIds()).length === ids.length - 1 || (await deckIds()).length === 2);
check("the playing deck has no remove button", (await page.$$(`${deck(4)} [data-act="remove"]`)).length === 0);

console.log("failures");
await page.click("#hoBlend");
const countBefore = (await deckIds()).length;
await queue("https://youtu.be/boom");
check("a failed download shows a calm explanation", await waitFor(() => /prove it isn't a bot/.test(document.querySelector("#notice")?.textContent || ""), 8000));
check("and leaves no deck stuck fetching", (await page.$$("#decks .fetching")).length === 0 && (await deckIds()).length === countBefore);
await page.fill("#url", "https://vimeo.com/123");
await page.click("#go");
check("a non-YouTube link is turned away before the server", /doesn't look like a YouTube link/.test(await page.textContent("#notice")));

console.log("deck controls");
const head = (await deckIds())[0];
await page.fill(`${deck(head)} .bpm-in`, "128");
await page.$eval(`${deck(head)} input[data-k="pitch"]`, (e) => { e.value = 2; e.dispatchEvent(new Event("input", { bubbles: true })); });
check("pitch slider updates its readout", (await page.textContent(`${deck(head)} .slider .val`)) === "+2.0%");
await page.click(`${deck(head)} [data-act="mute"]`);
check("mute toggles", (await page.getAttribute(`${deck(head)} [data-act="mute"]`, "aria-pressed")) === "true");
await page.click(`${deck(head)} [data-act="mute"]`);
await page.click(`${deck(head)} [data-act="load-loop"]`);
check("demo loop loads straight into a deck", await waitFor((id) => /^Demo /.test(document.querySelector(`#decks article[data-id="${id}"] .title`)?.textContent || ""), 4000, head));
await page.click("#addDeck");
check("add deck makes an empty one", (await page.$$("#decks .drop")).length >= 1);

console.log("sampler");
await page.click('.pad[data-pad="0"]');
await page.selectOption("#capDeck", "master");
await sleep(300);
await page.click("#capGo");
check("sampling the master fills a pad", await waitFor(() => /master/.test(document.querySelector('.pad[data-pad="5"] .pn')?.textContent || ""), 4000));
check("current-deck source is offered", (await page.$$eval("#capDeck option", (o) => o.map((x) => x.textContent))).join() === "Current deck,Deck 1,Deck 2,Deck 3,Deck 4,Master");

await page.screenshot({ path: path.join(OUT, "06-final.png"), fullPage: true });
await page.setViewportSize({ width: 390, height: 900 });
await sleep(200);
check("phone width: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
await page.screenshot({ path: path.join(OUT, "07-phone.png"), fullPage: true });

check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close(); web.close(); rs.wss.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ndj_browser_test: ${passed} passed, ${failed} failed  (screenshots: ${OUT})`);
process.exit(failed ? 1 : 0);
