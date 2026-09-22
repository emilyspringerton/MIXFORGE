// room_server.mjs -- real DJ-room server: seat occupancy, join/leave, whose-turn broadcast.
// Founder real-time (kanban T46478755, direct follow-up to room.prn/room.wasm's turn-order
// proof): "build the DJ-room server (seat occupancy, join/leave, whose-turn broadcast)".
//
// Real, deliberate design: the AUTHORITATIVE turn-order math is NOT reimplemented here in
// JavaScript -- this server loads and calls the exact same web/room.wasm the browser client
// uses (compiled from PARENA/stdlib/mixforge/room.prn), so there is exactly one real source of
// truth for "what seat comes next," not a server copy that could silently drift from the
// client's own copy. What IS real, new, host-side work (same "PARENA emits the decision, a thin
// hand-written host wires it to the real platform" shape examples/avr/blink.prn's own header
// comment already establishes for a different platform): seat OCCUPANCY (who is actually
// sitting where) and skipping empty seats when advancing turn -- both need an array/state shape
// room.wasm's own scalar-only v0 (no arrays/structs, see PARENA/docs/LLVM_BACKEND_NORTHSTAR.md)
// cannot express yet. This is the exact same real defstruct/array gap already named in
// CAPTCHA_FPS_PHYSICS_DOGFOOD_NORTHSTAR.md's own Phase 1 -- inherited here, not a new discovery.
//
// Real, honest, not done: no audio sync (Phase 5, media/stream.prn, still design-only), no
// track queue persistence (a queued URL is broadcast and forgotten, not stored), no auth/
// identity (a client is just its WebSocket connection, no IDUNA account linkage yet -- real,
// separate follow-up, same shape DEADWEIGHT/ECOWAR/SLOWBOT_LEAGUE's own real guest-auth
// integrations already establish elsewhere in this monorepo, not done here).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { WebSocketServer } from "ws";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, "..", "web", "room.wasm");
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const { next_seat, is_valid_seat, max_seats } = instance.exports;

const MAX_SEATS = max_seats();

export class Room {
  constructor() {
    this.seats = new Array(MAX_SEATS).fill(null); // null or { id, ws }
    this.currentTurn = 0;
  }

  occupiedCount() {
    return this.seats.filter((s) => s !== null).length;
  }

  // findFreeSeat -- host-side occupancy scan. is_valid_seat is the real PARENA bounds-check
  // export (kept as the real, single source of truth for "is this index even in range"), the
  // null check is real, necessarily host-side occupancy state.
  findFreeSeat() {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (is_valid_seat(i, MAX_SEATS) && this.seats[i] === null) return i;
    }
    return -1;
  }

  join(id, ws) {
    const seat = this.findFreeSeat();
    if (seat === -1) return -1;
    this.seats[seat] = { id, ws };
    return seat;
  }

  leave(id) {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (this.seats[i] && this.seats[i].id === id) {
        this.seats[i] = null;
        return i;
      }
    }
    return -1;
  }

  seatOf(id) {
    for (let i = 0; i < MAX_SEATS; i++) {
      if (this.seats[i] && this.seats[i].id === id) return i;
    }
    return -1;
  }

  // advanceTurn -- real, host-side occupancy-skip loop layered on top of room.wasm's real,
  // pure next_seat: call the PARENA export repeatedly (never reimplement its wraparound math),
  // stop at the first OCCUPIED seat, or give up after one full lap if the room is empty (a
  // real, honest "no one to hand the turn to" case, not an infinite loop).
  advanceTurn() {
    let seat = this.currentTurn;
    for (let i = 0; i < MAX_SEATS; i++) {
      seat = next_seat(seat, MAX_SEATS);
      if (this.seats[seat] !== null) {
        this.currentTurn = seat;
        return seat;
      }
    }
    return -1; // room is empty
  }

  state() {
    return {
      type: "room_state",
      maxSeats: MAX_SEATS,
      seats: this.seats.map((s) => (s ? { id: s.id } : null)),
      currentTurn: this.currentTurn,
    };
  }
}

export function broadcast(room, msg) {
  const text = JSON.stringify(msg);
  for (const seat of room.seats) {
    if (seat && seat.ws.readyState === seat.ws.OPEN) seat.ws.send(text);
  }
}

export function startServer(port) {
  const room = new Room();
  const wss = new WebSocketServer({ port });

  wss.on("connection", (ws) => {
    const id = crypto.randomUUID();
    const seat = room.join(id, ws);
    if (seat === -1) {
      ws.send(JSON.stringify({ type: "room_full", maxSeats: MAX_SEATS }));
      ws.close();
      return;
    }
    ws.send(JSON.stringify({ type: "joined", seat }));
    broadcast(room, room.state());

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return; // real, honest "ignore malformed input" -- not this v0's job to validate JSON shape further
      }
      if (msg.type === "queue_song") {
        const senderSeat = room.seatOf(id);
        if (senderSeat !== room.currentTurn) return; // only the seated DJ whose turn it is may queue
        broadcast(room, { type: "track_queued", seat: senderSeat, url: msg.url });
        room.advanceTurn();
        broadcast(room, room.state());
      }
    });

    ws.on("close", () => {
      room.leave(id);
      broadcast(room, room.state());
    });
  });

  return { wss, room, maxSeats: MAX_SEATS };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT || 8973);
  startServer(port);
  console.log(`mixforge room server listening on ws://127.0.0.1:${port} (max ${MAX_SEATS} seats)`);
}
