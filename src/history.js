/* History Log of deleted images (table history in D1, see migrations/).

   POST /api/delete-log  {username, password, action, images:[name,...]}
        Checks the re-entered username and password and, if they are right,
        records who deleted what. The page deletes the image only after this
        succeeds.
   GET  /api/delete-log  → {entries:[...]}, newest first (latest 1000).

   server.py has the same two routes for local use. */

import { Hono } from "hono";
import { checkLogin, allowAttempt } from "./auth.js";

const history = new Hono();

history.post("/", async (c) => {
  if (!(await allowAttempt(c))) return c.json({ error: "Too many attempts — wait a minute and try again" }, 429);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "Bad request" }, 400);
  const username = String(body.username || "").trim();
  if (!(await checkLogin(c.get("users"), username, String(body.password || "")))) {
    return c.json({ error: "Wrong username or password" }, 403);
  }
  const images = (Array.isArray(body.images) ? body.images : []).slice(0, 500).map((n) => String(n).slice(0, 200));
  await c.env.DB.prepare("INSERT INTO history (time, user, signed_in_as, action, images) VALUES (?, ?, ?, ?, ?)")
    .bind(new Date().toISOString(), username, c.get("user") || "", body.action === "wipe" ? "wipe" : "delete", JSON.stringify(images))
    .run();
  return c.json({ ok: true });
});

history.get("/", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT time, user, signed_in_as AS signedInAs, action, images FROM history ORDER BY time DESC, id DESC LIMIT 1000"
  ).all();
  return c.json({ entries: results.map((r) => ({ ...r, images: JSON.parse(r.images) })) });
});

export default history;
