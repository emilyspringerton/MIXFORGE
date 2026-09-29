// iduna.mjs -- IDUNA player identity for MIXFORGE (S513, founder real-time: "record button...
// save it to your IDUNA sso account"). MIXFORGE has no gameplay that needs a guest account of
// its own, so there's no bootstrap here -- the only identity flow is "Save to IDUNA": redirect to
// IDUNA's own hosted SSO login page (iam.okemily.com, the one real place a password is typed --
// IDUNA/internal/http/handlers/sso_login.go), then exchange the generic identity token it hands
// back for a real MIXFORGE-scoped player token via /api/v1/games/mixforge/sso-exchange (same-
// origin, proxied to IDUNA by this site's own nginx -- ops/nginx/mixforge-okemily.conf). That
// exchange is what game_online.go's own ssoExchange doc comment calls claiming a first-touch,
// never-scoped IDUNA identity for whichever game asks first -- no separate MIXFORGE registration
// step exists or is needed.
//
// Session lives in sessionStorage only: a 24h player token scoped to exactly mixforge.play plus
// this player's own recordings, not a long-lived credential worth persisting across days the way
// DEADWEIGHT's cookie-based guest account is.

const STORAGE_KEY = "mixforge_iduna_session";
const SSO_HOST = "iam.okemily.com";

function load() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function save(session) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* private mode etc. -- just won't persist */ }
}

export function currentSession() {
  const s = load();
  if (!s || !s.expiresAt || s.expiresAt * 1000 <= Date.now()) return null;
  return s;
}

export function isSignedIn() {
  return currentSession() !== null;
}

export function signOut() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

async function exchangeSsoToken(ssoToken) {
  if (!ssoToken) return null;
  try {
    const res = await fetch("/api/v1/games/mixforge/sso-exchange", {
      method: "POST",
      headers: { Authorization: "Bearer " + ssoToken },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `sso-exchange failed (${res.status})`);
    const session = { token: body.token, playerId: body.player_id, displayName: body.display_name, expiresAt: body.expires_at };
    save(session);
    return session;
  } catch (err) {
    console.warn("MIXFORGE/IDUNA sign-in failed:", err);
    return null;
  }
}

// maybeHandlePopupReturn -- call once, first thing, on every page that might BE the SSO popup
// (see startSignIn below). If this window is a popup (window.opener set) returning from the SSO
// page with a token in its URL fragment, it exchanges the token itself (same-origin fetch works
// fine here, it's just another load of this same site), hands the resulting session to its
// opener via postMessage, shows a one-line confirmation, and closes itself -- the caller should
// stop (not boot the full DJ engine) if this returns true.
export async function maybeHandlePopupReturn() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash.includes("sso_token=") || !window.opener) return false;
  const ssoToken = new URLSearchParams(hash).get("sso_token");
  const session = await exchangeSsoToken(ssoToken);
  try { window.opener.postMessage({ type: "mixforge-iduna-session", session }, location.origin); } catch { /* opener gone */ }
  document.body.innerHTML = session
    ? '<p style="font:16px system-ui;color:#7dff9a;padding:2rem">Signed in — you can close this window.</p>'
    : '<p style="font:16px system-ui;color:#ff4f4f;padding:2rem">Sign-in failed — you can close this window and try again.</p>';
  setTimeout(() => window.close(), 900);
  return true;
}

// consumeReturnFragment -- call once on a normal (non-popup) page load, for the fallback path
// where startSignIn's popup was blocked and it fell back to a full-page redirect. Exchanges and
// strips #sso_token=... from the URL exactly like the popup path does, just in the same window.
export async function consumeReturnFragment() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  if (!hash.includes("sso_token=")) return currentSession();
  const ssoToken = new URLSearchParams(hash).get("sso_token");
  history.replaceState(null, "", location.pathname + location.search);
  return exchangeSsoToken(ssoToken);
}

// startSignIn -- opens IDUNA's hosted SSO page in a popup (so the calling page, and anything held
// in its memory -- e.g. a just-recorded mix not yet saved -- survives), and resolves once the
// popup posts back a session (or is closed without one). Must be called synchronously from a user
// gesture (a button click handler, never after an await) or browsers may block the popup; if
// window.open still fails, falls back to a full-page redirect, which loses in-memory state -- a
// real, accepted limitation for that rare case rather than added complexity to work around it.
export function startSignIn() {
  const returnTo = location.href.split("#")[0];
  const url = `https://${SSO_HOST}/api/v1/auth/sso/login?redirect_uri=${encodeURIComponent(returnTo)}`;
  return new Promise((resolve) => {
    let popup;
    try { popup = window.open(url, "mixforge-iduna-sso", "width=460,height=640"); } catch { popup = null; }
    if (!popup) { location.href = url; resolve(null); return; }
    let poll;
    function onMessage(ev) {
      if (ev.origin !== location.origin || !ev.data || ev.data.type !== "mixforge-iduna-session") return;
      window.removeEventListener("message", onMessage);
      clearInterval(poll);
      // sessionStorage is scoped per top-level browsing context, not shared with the popup that
      // exchanged the token -- save() there never reaches here. This save() call, in the opener's
      // own context, is the one that actually matters (real, live-found bug: the popup flow
      // completed and posted a session back, but apiFetch still saw "not signed in" because
      // nothing had ever written it into *this* window's sessionStorage).
      if (ev.data.session) save(ev.data.session);
      resolve(ev.data.session || null);
    }
    window.addEventListener("message", onMessage);
    poll = setInterval(() => {
      if (popup.closed) {
        clearInterval(poll);
        window.removeEventListener("message", onMessage);
        resolve(currentSession());
      }
    }, 500);
  });
}

// apiFetch -- fetch() against this site's own same-origin /api/ proxy (see ops/nginx/mixforge-
// okemily.conf) with the current session's bearer token attached. Throws if not signed in --
// callers should check isSignedIn()/startSignIn() first.
export async function apiFetch(path, opts = {}) {
  const s = currentSession();
  if (!s) throw new Error("not signed in");
  const headers = new Headers(opts.headers || {});
  headers.set("Authorization", "Bearer " + s.token);
  return fetch(path, { ...opts, headers });
}
