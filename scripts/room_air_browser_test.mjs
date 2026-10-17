// room_air_browser_test.mjs -- two real headless-Chromium tabs in the DJ room: tab 1 plays its demo decks and goes on
// air; tab 2 must receive, decode and schedule the stream (non-silent), keep its own decks untouched, and recover when
// tab 1 stops. Run with Opus (WebCodecs) and again with the PCM fallback.
//
//   NODE_PATH=<dir with playwright> PLAYWRIGHT_BROWSERS_PATH=<browsers dir> node scripts/room_air_browser_test.mjs
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { startServer } from "../server/room_server.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const WSPORT = 8983;
startServer(WSPORT, "127.0.0.1", async () => ({ ok: false, error: "no downloads in this test" }), 60000);
const MIME = { ".html": "text/html", ".mjs": "text/javascript", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm" };
const web = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = path.join(WEB, u === "/" ? "multiplayer.html" : u);
  if (!file.startsWith(WEB) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
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

let passed = 0, failed = 0;
const check = (n, ok, d = "") => { if (ok) { passed++; console.log(`  ok   ${n}`); } else { failed++; console.error(`  FAIL ${n} ${d}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
async function tab(name, noOpus) {
  const page = await (await browser.newContext()).newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts\.g|net::ERR/.test(m.text())) page.errors.push(m.text()); });
  if (noOpus) await page.addInitScript(() => { delete window.AudioEncoder; delete window.AudioDecoder; });
  await page.goto(BASE + "/multiplayer.html");
  await page.click("#start");
  await page.waitForSelector("#overlay", { state: "detached" });
  return page;
}
const air = (p) => p.evaluate(() => window.mixforgeAir());
const waitFor = (p, fn, arg, ms = 15000) => p.waitForFunction(fn, arg, { timeout: ms }).then(() => true, () => false);

for (const mode of ["opus", "pcm16"]) {
  console.log(`\n== ${mode}`);
  const a = await tab("A", mode === "pcm16"), b = await tab("B", false);
  await waitFor(a, () => document.querySelector("#wsStatus")?.textContent === "connected");
  await waitFor(b, () => document.querySelector("#wsStatus")?.textContent === "connected");
  check("button is enabled once audio is on", await waitFor(a, () => !document.querySelector("#air").disabled));
  await a.click("#playAll");
  await sleep(400);
  const decksBefore = await b.$$eval("#main .deck, #main article", (n) => n.length);
  await a.click("#air");
  check("broadcaster is on air with the expected codec", await waitFor(a, (m) => window.mixforgeAir().broadcasting === m, mode));
  check("listener's button is locked while someone else is on air", await waitFor(b, () => document.querySelector("#air").disabled && /on air/.test(document.querySelector("#airNote").textContent)));
  check("listener is receiving frames", await waitFor(b, () => (window.mixforgeAir().listener?.played || 0) > 20));
  await sleep(1200);
  const st = (await air(b)).listener;
  check("received audio is not silence", st && st.peak > 0.01, JSON.stringify(st));
  check("stream is mostly clean (few drops)", st && st.dropped <= 2 && st.played > 40, JSON.stringify(st));
  check("on-air volume control is shown to the listener", !(await b.$eval("#airVolWrap", (e) => e.hidden)));
  check("listener's own decks are untouched", (await b.$$eval("#main .deck, #main article", (n) => n.length)) === decksBefore);
  check("broadcaster shows a live bitrate", await waitFor(a, () => /kbit\/s/.test(document.querySelector("#airNote").textContent)));
  await a.click("#air");
  check("stopping ends it for the listener", await waitFor(b, () => window.mixforgeAir().airSeat === -1 && !document.querySelector("#air").disabled));
  check("listener bus is torn down", (await air(b)).listener === null);
  check("no page errors", a.errors.length === 0 && b.errors.length === 0, JSON.stringify([a.errors, b.errors]));
  await a.context().close(); await b.context().close();
}

await browser.close(); web.close();
console.log(`\nroom_air_browser_test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
