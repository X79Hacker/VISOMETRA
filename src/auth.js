/* Logins and sessions.

   The accounts come from the SITE_USERS secret: one "username:password" per
   line or separated by commas. Logging in on /login sets a session cookie
   that lasts until the user presses Terminate (POST /api/logout).

   The cookie (__Host-sm_session, HTTPS only, not readable by page scripts) is
   "<user>.<issued>.<signature>": an HMAC keyed with that user's password and
   SESSION_SECRET, so it cannot be forged, and changing an account's password
   — or SESSION_SECRET — ends its sessions.

   requireLogin runs before every request, pages and files included
   (run_worker_first in wrangler.toml), and hands the API the logged-in name
   as c.get("user"). server.py has the same rules for local use. */

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const COOKIE = "sm_session"; // sent as __Host-sm_session
const MAX_AGE = 400 * 24 * 3600; // the longest a browser keeps a cookie; renewed on every page visit

// reachable without a session: the login page and the login call
const PUBLIC = /^\/(login(\.html)?|api\/login)$/;
const LOGIN_PAGE = /^\/login(\.html)?$/;
// files that never contain user data, so the browser may keep a copy for a while
const STATIC = /\.(js|css|svg|ico|png|jpe?g|webp|woff2?)$/i;

export function parseUsers(raw) {
  const users = new Map();
  for (const entry of (raw || "").split(/[\n,]/)) {
    const i = entry.indexOf(":");
    if (i > 0) users.set(entry.slice(0, i).trim(), entry.slice(i + 1).trim());
  }
  return users;
}

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (ch) => ch.charCodeAt(0));

// Compare SHA-256 digests in constant time, so response timing reveals nothing.
async function same(a, b) {
  const [x, y] = await Promise.all([crypto.subtle.digest("SHA-256", enc.encode(a)), crypto.subtle.digest("SHA-256", enc.encode(b))]);
  return crypto.subtle.timingSafeEqual(x, y);
}

export async function checkLogin(users, user, pass) {
  const expected = users.get(user);
  return expected !== undefined && (await same(pass, expected));
}

/* false once an address has used up its login attempts for this minute (LOGIN_LIMIT in wrangler.toml). */
export async function allowAttempt(c) {
  if (!c.env.LOGIN_LIMIT) return true;
  const ip = c.req.header("CF-Connecting-IP") || "local";
  const { success } = await c.env.LOGIN_LIMIT.limit({ key: "login:" + ip });
  return success;
}

async function sign(env, users, user, issued) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("sector-map-session\n" + (env.SESSION_SECRET || "") + "\n" + users.get(user)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(user + "\n" + issued))));
}

async function startSession(c, users, user, issued = Date.now()) {
  const value = b64url(enc.encode(user)) + "." + issued + "." + (await sign(c.env, users, user, issued));
  setCookie(c, COOKIE, value, { prefix: "host", httpOnly: true, sameSite: "Lax", maxAge: MAX_AGE });
}

/* {user, issued} of a valid session cookie, or null. */
async function readSession(c, users) {
  const raw = getCookie(c, COOKIE, "host");
  if (!raw) return null;
  const [u, issued, sig] = raw.split(".");
  if (!u || !sig || !/^\d+$/.test(issued || "")) return null;
  let user;
  try {
    user = new TextDecoder().decode(fromB64url(u));
  } catch {
    return null;
  }
  if (!users.has(user)) return null; // account removed
  return (await same(sig, await sign(c.env, users, user, issued))) ? { user, issued: Number(issued) } : null;
}

export const requireLogin = createMiddleware(async (c, next) => {
  const users = parseUsers(c.env.SITE_USERS);
  if (!users.size) return c.text("Login is not configured: set the SITE_USERS secret.", 500);
  c.set("users", users);

  const url = new URL(c.req.url);
  const session = await readSession(c, users);
  if (!session && !PUBLIC.test(url.pathname)) {
    const wantsPage = c.req.method === "GET" && (c.req.header("Accept") || "").includes("text/html");
    if (wantsPage) return c.redirect("/login?next=" + encodeURIComponent(url.pathname + url.search));
    return c.json({ error: "Not logged in", login: "/login" }, 401);
  }
  if (session && LOGIN_PAGE.test(url.pathname)) {
    // logged in already: skip the login page
    const to = url.searchParams.get("next");
    return c.redirect(to && to.startsWith("/") && !to.startsWith("//") ? to : "/dashboard-front.html");
  }
  if (session) c.set("user", session.user);

  await next();

  const isGet = c.req.method === "GET";
  if (isGet && STATIC.test(url.pathname) && !url.pathname.startsWith("/api/")) {
    // scripts, styles, icons: kept 5 minutes, then the browser uses its copy while it fetches a fresh one.
    // "private": only this user's browser keeps them, never a shared cache.
    c.header("Cache-Control", "private, max-age=300, stale-while-revalidate=86400");
  } else if (!/immutable/.test(c.res.headers.get("Cache-Control") || "")) {
    // pages and all data: never stored (image files from api/store/blob keep their own "immutable")
    c.header("Cache-Control", "private, no-store");
  }
  // keep the session alive: re-issue the cookie on page visits (same issue time)
  if (session && isGet && (c.res.headers.get("Content-Type") || "").includes("text/html")) {
    await startSession(c, users, session.user, session.issued);
  }
});

/* POST /api/login {username, password} · POST /api/logout · GET /api/me */
export const account = new Hono();

account.post("/login", async (c) => {
  if (!(await allowAttempt(c))) return c.json({ error: "Too many attempts — wait a minute and try again" }, 429);
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const users = c.get("users");
  if (!username || !(await checkLogin(users, username, String(body.password || "")))) {
    return c.json({ error: "Wrong username or password" }, 403);
  }
  await startSession(c, users, username);
  return c.json({ ok: true, user: username });
});

account.post("/logout", (c) => {
  deleteCookie(c, COOKIE, { prefix: "host" });
  return c.json({ ok: true });
});

account.get("/me", (c) => c.json({ user: c.get("user") || null }));
