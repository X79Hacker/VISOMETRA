"""Local web server for the Sector Map app.

Serves this folder at http://127.0.0.1:8763/ and opens the dashboard in the
default browser. Uses only the Python standard library (Python 3.7+).

    python server.py               # default port 8763
    python server.py 9000          # another port
    python server.py 9000 --no-browser

Images, cell drawings and traces are kept in the "data" folder next to this
file (data/shared.sqlite and data/images/), through the /api/store routes
that shared-store.js calls — the same routes the Cloudflare version has in
functions/api/store/[[path]].js — so every browser that opens this server
sees the same maps.

Results (areas, and the frequency / amplitude / phase of every circle) are
written to CSV files in the "results" folder next to this file:

    results/measurements.csv   one row per saved result (cell or whole trace)
    results/circles.csv        one row per circle, linked by measurement_id
    results/cell_areas.csv     per-cell areas of a traced outline

The pages save through POST /api/save; the Saved Results page reads them back
through GET /api/results, /api/circles?id=..., /api/cells?id=..., and
GET /api/download returns all three files as one zip.

Every page needs a login: POST /api/login sets a session cookie that lasts
until POST /api/logout (the dashboard's Terminate button); GET /api/me returns
the username. The logged-in name is written as "saved by" and "signed in as",
whatever the page sends. Sessions are signed with data/session_secret (made on
first use) and the account's password, so they survive server restarts and
end when that password changes.

Deleting an image asks for a username and password; POST /api/delete-log
checks them and appends the delete to results/delete_log.csv, which
GET /api/delete-log reads back for the History Log. The accounts come from
the SITE_USERS environment variable ("name:password, name:password"); if it
is not set, any username is accepted, since only you use the local server.
"""
import csv
import hmac
import http.server
import io
import json
import os
import re
import sqlite3
import sys
import time
import threading
import urllib.parse
import uuid
import webbrowser
import zipfile
from datetime import datetime

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
PORT = int(ARGS[0]) if ARGS else 8763
HOST = "127.0.0.1"
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(HERE, "public")  # the pages, the same folder Cloudflare serves
RESULTS = os.environ.get("SECTOR_MAP_RESULTS_DIR", os.path.join(HERE, "results"))
LOCK = threading.Lock()

MEAS_COLS = ["measurement_id", "saved_at", "saved_by", "image_id", "image_name", "scope", "cell_row", "cell_col",
             "unit", "cell_width", "cell_height", "area_bezier", "area_shoelace", "area_fourier", "perimeter",
             "width", "height", "centroid_x", "centroid_y", "direction", "recon_error", "num_circles",
             "expected_area", "percent_error", "outline_json"]
CIRC_COLS = ["measurement_id", "image_name", "scope", "cell_row", "cell_col", "rank", "freq_k", "amplitude",
             "amplitude_px", "phase_rad", "phase_deg", "direction", "cum_area", "unit"]
CELL_COLS = ["measurement_id", "image_name", "cell_row", "cell_col", "area", "coverage_pct", "unit"]
FILES = {"measurements.csv": MEAS_COLS, "circles.csv": CIRC_COLS, "cell_areas.csv": CELL_COLS}
LOG_FILE, LOG_COLS = "delete_log.csv", ["time", "user", "signedInAs", "action", "images"]

DATA = os.environ.get("SECTOR_MAP_DATA_DIR", os.path.join(HERE, "data"))
IMAGES = os.path.join(DATA, "images")
STORES = ("files", "patches", "traces", "episodes", "projects", "frameinfo")
STORE_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
MAX_IMAGE = 25 * 1024 * 1024


class StoreError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


def store_db():
    os.makedirs(IMAGES, exist_ok=True)
    con = sqlite3.connect(os.path.join(DATA, "shared.sqlite"))
    con.execute("CREATE TABLE IF NOT EXISTS records (store TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,"
                " updated_at INTEGER NOT NULL, PRIMARY KEY (store, id))")
    con.execute("CREATE TABLE IF NOT EXISTS deleted (id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL)")
    return con


def store_request(method, parts, body=None, ctype=None):
    """The /api/store routes (see functions/api/store/[[path]].js). Returns (status, content-type, bytes)."""
    store, rid = (parts + [None, None])[:2]
    if len(parts) > 2 or (rid is not None and not STORE_ID.match(rid)):
        raise StoreError(400, "Bad path")
    ok = (200, "application/json", b'{"ok": true}')
    with LOCK:
        con = store_db()
        try:
            gone = rid is not None and con.execute("SELECT 1 FROM deleted WHERE id = ?", (rid,)).fetchone()
            if store == "blob" and rid:
                path = os.path.join(IMAGES, rid)
                if method == "GET":
                    if not os.path.exists(path):
                        raise StoreError(404, "No such image")
                    with open(path + ".type", encoding="utf-8") as fh:
                        kind = fh.read() or "application/octet-stream"
                    with open(path, "rb") as fh:
                        return 200, kind, fh.read()
                if method == "PUT":
                    if gone:
                        raise StoreError(410, "This image was deleted")
                    if len(body) > MAX_IMAGE:
                        raise StoreError(413, "The image is larger than 25 MB")
                    with open(path, "wb") as fh:
                        fh.write(body)
                    with open(path + ".type", "w", encoding="utf-8") as fh:
                        fh.write((ctype or "application/octet-stream")[:100])
                    return ok
                raise StoreError(405, "Method not allowed")
            if store not in STORES:
                raise StoreError(404, "No such store")
            if rid:
                if method == "GET":
                    row = con.execute("SELECT data FROM records WHERE store = ? AND id = ?", (store, rid)).fetchone()
                    if not row:
                        raise StoreError(404, "Not found")
                    return 200, "application/json", row[0].encode()
                if method == "PUT":
                    text = body.decode("utf-8")
                    json.loads(text)
                    if gone:
                        raise StoreError(410, "This image was deleted")
                    con.execute("INSERT OR REPLACE INTO records VALUES (?, ?, ?, ?)",
                                (store, rid, text, int(time.time() * 1000)))
                elif method == "DELETE":
                    if store == "files":
                        con.execute("DELETE FROM records WHERE id = ?", (rid,))
                        con.execute("INSERT OR REPLACE INTO deleted VALUES (?, ?)", (rid, int(time.time() * 1000)))
                        remove_images([rid])
                    else:
                        con.execute("DELETE FROM records WHERE store = ? AND id = ?", (store, rid))
                else:
                    raise StoreError(405, "Method not allowed")
                con.commit()
                return ok
            if method == "GET":
                rows = [r[0] for r in con.execute("SELECT data FROM records WHERE store = ? ORDER BY id", (store,))]
                out = '{"records":[' + ",".join(rows) + "]"
                if store == "files":
                    out += ',"deleted":' + json.dumps([r[0] for r in con.execute("SELECT id FROM deleted")])
                return 200, "application/json", (out + "}").encode()
            if method == "DELETE":
                if store == "files":
                    ids = [r[0] for r in con.execute("SELECT id FROM records WHERE store = 'files'")]
                    con.executemany("INSERT OR REPLACE INTO deleted VALUES (?, ?)",
                                    [(i, int(time.time() * 1000)) for i in ids])
                    con.execute("DELETE FROM records")
                    remove_images(ids)
                else:
                    con.execute("DELETE FROM records WHERE store = ?", (store,))
                con.commit()
                return ok
            raise StoreError(405, "Method not allowed")
        finally:
            con.close()


def remove_images(ids):
    for i in ids:
        for p in (os.path.join(IMAGES, i), os.path.join(IMAGES, i + ".type")):
            if os.path.exists(p):
                os.remove(p)


def csv_path(name):
    return os.path.join(RESULTS, name)


def append_rows(name, rows, cols=None):
    """Append rows; a new file starts with a UTF-8 BOM (so Excel reads ² and accents) and a header."""
    path = csv_path(name)
    new = not os.path.exists(path) or os.path.getsize(path) == 0
    with open(path, "a", newline="", encoding="utf-8-sig" if new else "utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols or FILES[name], extrasaction="ignore")
        if new:
            w.writeheader()
        for r in rows:
            w.writerow({k: ("" if v is None else v) for k, v in r.items()})


def read_rows(name):
    path = csv_path(name)
    if not os.path.exists(path):
        return []
    with open(path, newline="", encoding="utf-8-sig") as fh:
        return list(csv.DictReader(fh))


def save_result(p, login_user=""):
    if login_user:
        p["saved_by"] = login_user  # the login name wins over what the page sent
    img = p.get("image") or {}
    if not img.get("id") or not img.get("name"):
        raise ValueError("image id and name are required")
    if p.get("scope") not in ("cell", "trace"):
        raise ValueError("scope must be cell or trace")
    circles = p.get("circles") or []
    cells = p.get("cell_areas") or []
    if len(circles) > 5000 or len(cells) > 256:
        raise ValueError("too many rows")
    mid = uuid.uuid4().hex[:12]
    unit = p.get("unit") or img.get("unit") or ""
    meas = {k: p.get(k) for k in MEAS_COLS}
    meas.update(measurement_id=mid, saved_at=datetime.now().isoformat(timespec="seconds"),
                saved_by=(p.get("saved_by") or "")[:60], image_id=img["id"], image_name=img["name"],
                unit=unit, cell_width=img.get("cell_width"), cell_height=img.get("cell_height"),
                outline_json=json.dumps(p["outline"], separators=(",", ":")) if p.get("outline") else "")
    base = {"measurement_id": mid, "image_name": img["name"], "unit": unit}
    with LOCK:
        os.makedirs(RESULTS, exist_ok=True)
        append_rows("measurements.csv", [meas])
        append_rows("circles.csv", [dict(base, scope=p["scope"], cell_row=p.get("cell_row"),
                                         cell_col=p.get("cell_col"), **c) for c in circles])
        append_rows("cell_areas.csv", [dict(base, **c) for c in cells])
    return mid


def site_users():
    """SITE_USERS = "name:password, name:password" (same format as on Cloudflare)."""
    users = {}
    for entry in os.environ.get("SITE_USERS", "").replace("\n", ",").split(","):
        name, sep, pw = entry.partition(":")
        if sep and name.strip():
            users[name.strip()] = pw.strip()
    return users


def login_ok(user, password):
    """Same rule as the Cloudflare login."""
    users = site_users()
    if not users:
        return bool(user)  # no accounts set up: local single-user mode, any name is accepted
    return user in users and hmac.compare_digest(password.encode(), users[user].encode())


# ---------- sessions: log in once, stay logged in until Terminate (same as functions/_middleware.js) ----------
SESSION_COOKIE = "sm_session"
SESSION_MAX_AGE = 400 * 24 * 3600  # the longest a browser keeps a cookie; renewed on every page visit
PUBLIC_PATHS = ("/login.html", "/api/login")


def session_secret():
    """A random key kept in data/session_secret, so sessions survive server restarts."""
    path = os.path.join(DATA, "session_secret")
    with LOCK:
        if not os.path.exists(path):
            os.makedirs(DATA, exist_ok=True)
            with open(path, "w", encoding="ascii") as fh:
                fh.write(uuid.uuid4().hex + uuid.uuid4().hex)
        with open(path, encoding="ascii") as fh:
            return fh.read().strip()


def session_sig(user, issued):
    # keyed with the account's password too: changing or removing it ends that account's sessions
    key = (session_secret() + "\n" + site_users().get(user, "")).encode()
    return hmac.new(key, (user + "\n" + str(issued)).encode(), "sha256").hexdigest()


def session_cookie(user, issued=None):
    issued = issued or int(time.time() * 1000)
    value = urllib.parse.quote(user, safe="") + "." + str(issued) + "." + session_sig(user, issued)
    return f"{SESSION_COOKIE}={value}; Path=/; Max-Age={SESSION_MAX_AGE}; HttpOnly; SameSite=Lax"


def read_session(cookie_header):
    """(user, issued) from a valid session cookie, or None."""
    for part in (cookie_header or "").split(";"):
        name, _, value = part.strip().partition("=")
        if name != SESSION_COOKIE:
            continue
        bits = value.split(".")
        if len(bits) != 3 or not bits[1].isdigit():
            return None
        user = urllib.parse.unquote(bits[0])
        users = site_users()
        if not user or (users and user not in users):
            return None
        if hmac.compare_digest(bits[2], session_sig(user, bits[1])):
            return user, int(bits[1])
    return None


def log_delete(p, signed_in=""):
    user = str(p.get("username") or "").strip()[:60]
    if not login_ok(user, str(p.get("password") or "")):
        raise PermissionError("Wrong username or password")
    images = [str(n)[:200] for n in (p.get("images") or [])[:500]]
    row = {"time": datetime.now().astimezone().isoformat(timespec="seconds"), "user": user, "signedInAs": signed_in,
           "action": "wipe" if p.get("action") == "wipe" else "delete", "images": json.dumps(images)}
    with LOCK:
        os.makedirs(RESULTS, exist_ok=True)
        append_rows(LOG_FILE, [row], LOG_COLS)


def read_delete_log():
    with LOCK:
        rows = read_rows(LOG_FILE)
    for r in rows:
        try:
            r["images"] = json.loads(r.get("images") or "[]")
        except ValueError:
            r["images"] = [r.get("images")]
    return rows[::-1]  # newest first


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files with caching off, plus the small /api used to save results to CSV."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def log_message(self, fmt, *args):
        pass  # keep the console quiet

    def send_json(self, code, obj, cookie=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def redirect(self, location, cookie=None):
        self.send_response(302)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def gate(self):
        """Login check for every request. True if it was answered here (login page redirect / 401)."""
        u = urllib.parse.urlparse(self.path)
        if u.path.startswith("/data/") or u.path == "/data":
            # the shared database and the session key: never served as files
            self.send_json(404, {"error": "not found"})
            return True
        session = read_session(self.headers.get("Cookie"))
        self.user = session[0] if session else ""
        self.renew = None
        if not session:
            if u.path in PUBLIC_PATHS:
                return False
            if self.command == "GET" and "text/html" in (self.headers.get("Accept") or ""):
                self.redirect("/login.html?next=" + urllib.parse.quote(u.path + ("?" + u.query if u.query else ""), safe=""))
            else:
                self.send_json(401, {"error": "Not logged in", "login": "/login.html"})
            return True
        if u.path == "/login.html":
            nxt = dict(urllib.parse.parse_qsl(u.query)).get("next") or ""
            self.redirect(nxt if nxt.startswith("/") and not nxt.startswith("//") else "/dashboard-front.html")
            return True
        if self.command == "GET" and "text/html" in (self.headers.get("Accept") or ""):
            self.renew = session_cookie(*session)  # keep the session alive on page visits
        return False

    def end_headers(self):
        renew = getattr(self, "renew", None)
        if renew:
            self.send_header("Set-Cookie", renew)
            self.renew = None
        self.send_header("Cache-Control", "no-store")
        http.server.BaseHTTPRequestHandler.end_headers(self)

    def handle_session_api(self, path):
        """POST /api/login, POST /api/logout, GET /api/me. True if handled."""
        if path == "/api/me" and self.command == "GET":
            self.send_json(200, {"user": self.user or None})
            return True
        if path == "/api/logout" and self.command == "POST":
            self.send_json(200, {"ok": True}, f"{SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
            return True
        if path == "/api/login" and self.command == "POST":
            try:
                n = int(self.headers.get("Content-Length", 0))
                p = json.loads(self.rfile.read(min(n, 10000)) or b"{}")
            except ValueError:
                self.send_json(400, {"error": "Bad request"})
                return True
            user = str(p.get("username") or "").strip()[:60]
            if not user or not login_ok(user, str(p.get("password") or "")):
                time.sleep(0.6)  # makes guessing passwords slow
                self.send_json(403, {"error": "Wrong username or password"})
                return True
            self.send_json(200, {"ok": True, "user": user}, session_cookie(user))
            return True
        return False

    def handle_store(self, method):
        """True if the request was for /api/store/... (and has been answered)."""
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/api/store/"):
            return False
        parts = [urllib.parse.unquote(p) for p in path[len("/api/store/"):].split("/") if p]
        try:
            body = None
            if method == "PUT":
                n = int(self.headers.get("Content-Length", 0))
                if n > 60 * 1024 * 1024:
                    raise StoreError(413, "Too large")
                body = self.rfile.read(n)
            code, kind, data = store_request(method, parts, body, self.headers.get("Content-Type"))
        except StoreError as e:
            self.send_json(e.code, {"error": str(e)})
            return True
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Bad JSON"})
            return True
        self.send_response(code)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
        return True

    def do_PUT(self):
        if self.gate():
            return
        if not self.handle_store("PUT"):
            self.send_json(404, {"error": "not found"})

    def do_DELETE(self):
        if self.gate():
            return
        if not self.handle_store("DELETE"):
            self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.gate():
            return
        path = urllib.parse.urlparse(self.path).path
        if self.handle_session_api(path):
            return
        if path == "/api/episodes/restore":
            from episode_archive import restore_episode, MAX_ARCHIVE
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_ARCHIVE:
                    return self.send_json(413, {"error": "Backup ZIP must be below 256 MB."})
                return self.send_json(200, restore_episode(sys.modules[__name__], self.rfile.read(length), self.user))
            except (ValueError, TypeError, KeyError, OSError, zipfile.BadZipFile) as exc:
                return self.send_json(400, {"error": "Backup was not restored: " + str(exc)})
        if path.startswith("/api/tracking/"):
            import tracking_backend
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 36 * 1024 * 1024:
                    return self.send_json(413, {"error": "Tracking request must be below 36 MB."})
                payload = json.loads(self.rfile.read(length))
                if not isinstance(payload, dict):
                    raise ValueError("Expected an object")
                parts = path.strip("/").split("/")
                if parts == ["api", "tracking", "jobs"]:
                    return self.send_json(200, tracking_backend.create(payload, self.user))
                if len(parts) == 5 and parts[:3] == ["api", "tracking", "jobs"]:
                    handler = {"upload": tracking_backend.upload, "start": lambda j,u,p: tracking_backend.start(j,u), "cancel": lambda j,u,p: tracking_backend.cancel(j,u)}.get(parts[4])
                    if handler:
                        return self.send_json(200, handler(parts[3], self.user, payload))
                return self.send_json(404, {"error": "Unknown tracking endpoint."})
            except tracking_backend.TrackingError as exc:
                return self.send_json(exc.status, {"error": str(exc)})
            except (ValueError, TypeError, UnicodeDecodeError):
                return self.send_json(400, {"error": "Invalid tracking request."})
        if path == "/api/sam/segment":
            import sam_backend
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16_000_000:
                    return self.send_json(413, {"error": "SAM image payload must be below 16 MB."})
                payload = json.loads(self.rfile.read(length))
                return self.send_json(200, sam_backend.segment(payload))
            except sam_backend.SamError as exc:
                return self.send_json(exc.status, {"error": str(exc), "engine": "SAM 3"})
            except (ValueError, TypeError, UnicodeDecodeError):
                return self.send_json(400, {"error": "Invalid SAM request JSON."})
        if path not in ("/api/save", "/api/delete-log"):
            return self.send_json(404, {"error": "not found"})
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 5_000_000:
                raise ValueError("payload too large")
            payload = json.loads(self.rfile.read(n) or b"{}")
            if path == "/api/delete-log":
                log_delete(payload, self.user)
                return self.send_json(200, {"ok": True})
            mid = save_result(payload, self.user)
            self.send_json(200, {"id": mid, "folder": RESULTS})
        except PermissionError as e:
            self.send_json(403, {"error": str(e)})
        except (ValueError, TypeError, KeyError) as e:
            self.send_json(400, {"error": str(e)})
        except OSError as e:
            # most often: measurements.csv is open in Excel, which locks the file
            self.send_json(500, {"error": "could not write the CSV file (" + e.strerror + ")"
                                 + " — close it in Excel and try again"})

    def do_GET(self):
        if self.gate():
            return
        if self.handle_session_api(urllib.parse.urlparse(self.path).path):
            return
        if self.handle_store("GET"):
            return
        u = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        if u.path == "/api/episodes/status":
            return self.send_json(200, {"backups": True, "max_archive_bytes": 256 * 1024 * 1024})
        if u.path == "/api/episodes/backup":
            from episode_archive import export_episode
            try:
                body = export_episode(sys.modules[__name__], q.get("id", ""))
            except (ValueError, TypeError, KeyError, OSError) as exc:
                return self.send_json(400, {"error": str(exc)})
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition", 'attachment; filename="episode-complete-backup.zip"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path.startswith("/api/tracking/"):
            import tracking_backend
            try:
                if u.path == "/api/tracking/status":
                    return self.send_json(200, tracking_backend.status())
                parts = u.path.strip("/").split("/")
                if len(parts) == 4 and parts[:3] == ["api", "tracking", "jobs"]:
                    return self.send_json(200, tracking_backend.poll(parts[3], self.user, int(q.get("after", "0"))))
                return self.send_json(404, {"error": "Unknown tracking endpoint."})
            except tracking_backend.TrackingError as exc:
                return self.send_json(exc.status, {"error": str(exc)})
            except (ValueError, TypeError):
                return self.send_json(400, {"error": "Invalid tracking job request."})
        if u.path == "/api/sam/status":
            import sam_backend
            return self.send_json(200, sam_backend.status())
        if u.path == "/api/results":
            with LOCK:
                rows = read_rows("measurements.csv")
            for r in rows:
                r.pop("outline_json", None)
            return self.send_json(200, {"rows": rows, "folder": RESULTS})
        if u.path == "/api/delete-log":
            return self.send_json(200, {"entries": read_delete_log()})
        if u.path in ("/api/circles", "/api/cells"):
            name = "circles.csv" if u.path == "/api/circles" else "cell_areas.csv"
            with LOCK:
                rows = [r for r in read_rows(name) if r.get("measurement_id") == q.get("id")]
            return self.send_json(200, {"rows": rows})
        if u.path == "/api/download":
            buf = io.BytesIO()
            with LOCK, zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                for name, cols in FILES.items():
                    path = csv_path(name)
                    if os.path.exists(path):
                        z.write(path, name)
                    else:
                        z.writestr(name, "﻿" + ",".join(cols) + "\r\n")
            body = buf.getvalue()
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Disposition",
                             'attachment; filename="sector-map-results-' + datetime.now().strftime("%Y%m%d-%H%M") + '.zip"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if u.path in ("/results/" + n for n in FILES):
            # the CSV links on the Saved Results page (the files live next to server.py, not in public/)
            name = u.path.rsplit("/", 1)[1]
            with LOCK:
                path = csv_path(name)
                body = open(path, "rb").read() if os.path.exists(path) else ("﻿" + ",".join(FILES[name]) + "\r\n").encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Disposition", 'attachment; filename="' + name + '"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        return super().do_GET()


def main():
    try:
        httpd = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print(f"Port {PORT} is already in use.")
        print("Stop the server using this port, or choose another port below. No browser was opened.")
        print(f"or start it on another port:  python server.py 9000")
        sys.exit(1)

    url = f"http://{HOST}:{PORT}/dashboard-front.html"
    print("Sector Map SEQUENCE STUDIO V6 is running from: " + HERE)
    print("Sector Map is running at:")
    print("   " + url)
    print("Results are saved as CSV in: " + RESULTS)
    print("Leave this window open while you use the app. Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
