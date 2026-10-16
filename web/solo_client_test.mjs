// solo_client_test.mjs -- URL normalising, and the fetch queue against a fake socket.
import { normalizeYoutubeUrl, createSoloClient } from "./solo-client.mjs";

let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.error(`  FAIL ${name} ${detail}`); }
}
const N = normalizeYoutubeUrl;
check("full watch URL passes", N("https://www.youtube.com/watch?v=abc123") === "https://www.youtube.com/watch?v=abc123");
check("bare youtu.be gets https", N("youtu.be/abc123") === "https://youtu.be/abc123");
check("mobile and music hosts become www", N("https://m.youtube.com/watch?v=x") === "https://www.youtube.com/watch?v=x" && N("music.youtube.com/watch?v=x") === "https://www.youtube.com/watch?v=x");
check("fragment is dropped (server allowlist has no #)", N("https://youtu.be/abc?t=5#frag") === "https://youtu.be/abc?t=5");
check("other hosts, empty, junk are refused", N("https://vimeo.com/1") === null && N("") === null && N("not a url at all") === null && N("https://youtube.com") === null && N("https://youtu.be/") === null);
check("look-alike hosts are refused", N("https://youtube.com.evil.io/watch?v=1") === null && N("https://notyoutu.be/x") === null);

class FakeWS {
  static last = null;
  constructor() { this.sent = []; FakeWS.last = this; queueMicrotask(() => this.onopen && this.onopen()); }
  send(t) { this.sent.push(JSON.parse(t)); }
  reply(m) { this.onmessage({ data: JSON.stringify(m) }); }
}
const c = createSoloClient({ wsUrl: "ws://x/ws?solo=1", WebSocketImpl: FakeWS });
const a = c.fetchTrack("https://youtu.be/a"), b = c.fetchTrack("https://youtu.be/b"), cc = c.fetchTrack("https://youtu.be/c");
await new Promise((r) => setTimeout(r, 5));
const ws = FakeWS.last;
check("only one fetch is in flight at a time", ws.sent.length === 1 && ws.sent[0].url.endsWith("/a"));
ws.reply({ type: "track_ready", reqId: ws.sent[0].reqId, url: "/room-cache/a.webm", title: "A", artist: "x" });
const ra = await a.promise;
check("first resolves with url/title/artist", ra.url === "/room-cache/a.webm" && ra.title === "A");
check("the next one starts only after the first settles", ws.sent.length === 2 && ws.sent[1].url.endsWith("/b"));
cc.cancel();
check("a waiting fetch can be cancelled", await cc.promise.then(() => false, (e) => e.message === "cancelled"));
ws.reply({ type: "track_failed", reqId: ws.sent[1].reqId, error: "bot check" });
check("failure rejects with the server's reason", await b.promise.then(() => false, (e) => e.message === "bot check"));
check("a cancelled fetch is never sent", ws.sent.length === 2);

console.log(`\nsolo_client_test: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
