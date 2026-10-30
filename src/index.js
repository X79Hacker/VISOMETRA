/* Sector Map — Cloudflare Worker.

   Serves the pages in public/ (static assets) and the API behind them, all
   behind a login. Every request runs here first (run_worker_first in
   wrangler.toml): requireLogin checks the session, then either an API route
   answers or the static page/file is served from the ASSETS binding.

   src/auth.js     login, logout, sessions
   src/store.js    shared images, drawings and traces   /api/store/...
   src/results.js  Saved Results and CSV/ZIP downloads  /api/save, /api/results, ...
   src/history.js  History Log of deletes               /api/delete-log
   migrations/     the D1 tables (npm run db:migrate) */

import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { requireLogin, account } from "./auth.js";
import store from "./store.js";
import results from "./results.js";
import history from "./history.js";

const app = new Hono();

// standard protective headers (no framing by other sites, no MIME sniffing, HSTS, …)
app.use(secureHeaders());
app.use(requireLogin);

app.route("/api", account);
app.route("/api/store", store);
app.route("/api/delete-log", history);
app.route("/", results);
app.get("/api/sam/status", (c) => c.json({available:false, runtime:"cloudflare",
  message:"SAM 3 requires the local Python server. The bundled Fast offline browser model works here."}));
app.post("/api/sam/segment", (c) => c.json({error:"SAM 3 runs through the local Python server. Start the downloaded app locally, or choose Fast offline."},503));
app.get("/api/episodes/status", c => c.json({backups:false, message:"Complete backup/restore uses the local Python server supplied in the ZIP."}));
app.get("/api/episodes/backup", c => c.json({error:"Run the supplied Python server locally to make a complete backup."}, 503));
app.post("/api/episodes/restore", c => c.json({error:"Run the supplied Python server locally to restore a complete backup."}, 503));
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// everything else: the pages, scripts and styles in public/
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

app.onError((err, c) => {
  console.error(c.req.method, c.req.path, err); // shows up in Workers Logs
  return c.json({ error: "Server error: " + err.message }, 500);
});

export default app;
