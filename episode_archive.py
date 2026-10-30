"""Portable episode archives. Restores create copies and never replace existing work."""
import copy
import csv
import io
import json
import os
import tempfile
import time
import uuid
import zipfile

MAX_ARCHIVE = 256 * 1024 * 1024
STORES = ("files", "patches", "traces", "projects", "frameinfo")
FORMAT = "sector-map-episode-backup-v1"


def _json(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def export_episode(app, episode_id):
    if not app.STORE_ID.fullmatch(episode_id or ""):
        raise ValueError("Choose a valid episode.")
    with app.LOCK:
        con = app.store_db()
        try:
            row = con.execute("SELECT data FROM records WHERE store='episodes' AND id=?", (episode_id,)).fetchone()
            if not row:
                raise ValueError("Episode not found.")
            episode = json.loads(row[0])
            frames, images, total_bytes = [], [], 0
            for fid in episode.get("frames", []):
                if not app.STORE_ID.fullmatch(fid):
                    raise ValueError("Episode contains an invalid image ID.")
                records = {}
                for store in STORES:
                    rec = con.execute("SELECT data FROM records WHERE store=? AND id=?", (store, fid)).fetchone()
                    if rec:
                        total_bytes += len(rec[0].encode("utf-8"))
                        if total_bytes > MAX_ARCHIVE - 1024:
                            raise ValueError("Episode records exceed the 256 MB backup limit.")
                    records[store] = json.loads(rec[0]) if rec else None
                if not records["files"]:
                    continue  # a deleted image is no longer an episode frame
                if len(frames) >= 500:
                    raise ValueError("Backup limit: 500 frames per episode.")
                image_path = os.path.join(app.IMAGES, fid)
                if not os.path.isfile(image_path):
                    raise ValueError("An episode image is missing. Repair it before making a backup.")
                with open(image_path, "rb") as fh:
                    pixels = fh.read(app.MAX_IMAGE + 1)
                if len(pixels) > app.MAX_IMAGE:
                    raise ValueError("An image exceeds the supported 25 MB limit.")
                total_bytes += len(pixels)
                if total_bytes > MAX_ARCHIVE - 1024:
                    raise ValueError("Episode images and records exceed the 256 MB backup limit.")
                with open(image_path + ".type", encoding="utf-8") as fh:
                    mime = fh.read()
                path = "images/" + str(len(frames)).zfill(5) + ".bin"
                images.append((path, pixels))
                frames.append({"id": fid, "image": path, "mime": mime, "records": records})
            live = {f["id"] for f in frames}
            episode["frames"] = [fid for fid in episode["frames"] if fid in live]
            measurements = [r for r in app.read_rows("measurements.csv") if r.get("image_id") in live]
            mids = {r["measurement_id"] for r in measurements}
            history = {"measurements.csv": measurements}
            for name in ("circles.csv", "cell_areas.csv"):
                history[name] = [r for r in app.read_rows(name) if r.get("measurement_id") in mids]
            manifest = {"format": FORMAT, "exportedAt": int(time.time() * 1000), "episode": episode,
                        "frames": frames, "history": history}
            encoded = _json(manifest)
            if len(encoded) + sum(len(b) for _, b in images) + 1024 > MAX_ARCHIVE or len(frames) > 500:
                raise ValueError("Backup limit: 500 frames and 256 MB of uncompressed images and records per episode.")
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
                z.writestr("manifest.json", encoded)
                for path, pixels in images:
                    z.writestr(path, pixels)
                z.writestr("README.txt", "Restore with Sector Map > Restore episode backup. Includes source images, frame metadata, grid drawings, traces, saved Studio projects and legacy measurement history. Restore creates a new episode with new IDs; existing work is kept.\n")
            return buf.getvalue()
        finally:
            con.close()


def _validate(payload):
    if len(payload) > MAX_ARCHIVE:
        raise ValueError("Backup ZIP must be below 256 MB.")
    try:
        z = zipfile.ZipFile(io.BytesIO(payload))
    except zipfile.BadZipFile:
        raise ValueError("Not a valid episode backup ZIP.") from None
    with z:
        entries = z.infolist()
        if len(entries) > 502 or sum(i.file_size for i in entries) > MAX_ARCHIVE or any(i.compress_type not in (0,8) or i.flag_bits & 1 for i in entries):
            raise ValueError("Backup expands beyond the 256 MB / 500-frame limit.")
        names = [i.filename for i in entries]
        if len(set(names)) != len(names) or "manifest.json" not in names:
            raise ValueError("Missing or duplicate backup entries.")
        try:
            manifest = json.loads(z.read("manifest.json"))
        except (ValueError, KeyError, UnicodeDecodeError):
            raise ValueError("Invalid backup manifest.") from None
        if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
            raise ValueError("This ZIP is not a complete Sector Map episode backup.")
        ep, frames, history = manifest.get("episode"), manifest.get("frames"), manifest.get("history")
        if (not isinstance(ep, dict) or not isinstance(ep.get("name"), str) or not ep["name"].strip()
                or not isinstance(ep.get("frames"), list) or not isinstance(frames, list) or len(frames) > 500
                or not isinstance(history, dict)):
            raise ValueError("Invalid episode data.")
        ids, pixels = set(), {}
        for frame in frames:
            if not isinstance(frame, dict) or not isinstance(frame.get("id"), str) or frame["id"] in ids:
                raise ValueError("Invalid or duplicate frame ID.")
            ids.add(frame["id"])
            records = frame.get("records")
            if not isinstance(records, dict) or not isinstance(records.get("files"), dict):
                raise ValueError("Missing image metadata.")
            if records["files"].get("id") != frame["id"] or not isinstance(records["files"].get("name"), str):
                raise ValueError("Image metadata does not match its frame.")
            for key in STORES:
                rec = records.get(key)
                if rec is not None and not isinstance(rec, dict):
                    raise ValueError("Invalid frame record.")
            project = records.get("projects")
            if project and (project.get("format") != "sector-map-outline-project" or not isinstance(project.get("image"), dict)):
                raise ValueError("Invalid saved Studio project.")
            path = frame.get("image")
            if not isinstance(path, str) or path not in names or not path.startswith("images/") or ".." in path or path in pixels:
                raise ValueError("Invalid image entry.")
            data = z.read(path)
            if not data or len(data) > 25 * 1024 * 1024 or not str(frame.get("mime", "")).startswith("image/"):
                raise ValueError("Invalid image bytes or image size.")
            pixels[path] = data
        if len(ep["frames"]) != len(ids) or set(ep["frames"]) != ids:
            raise ValueError("Frame order does not match the backup images.")
        rows = history.get("measurements.csv", [])
        if not isinstance(rows, list) or any(not isinstance(r, dict) or r.get("image_id") not in ids for r in rows):
            raise ValueError("Measurement history does not match the episode.")
        mids = [r.get("measurement_id") for r in rows]
        if any(not isinstance(mid, str) for mid in mids) or len(set(mids)) != len(mids):
            raise ValueError("Invalid measurement IDs.")
        for name in ("circles.csv", "cell_areas.csv"):
            rows = history.get(name, [])
            if not isinstance(rows, list) or any(not isinstance(r, dict) or r.get("measurement_id") not in mids for r in rows):
                raise ValueError("Invalid linked measurement history.")
        return manifest, pixels


def restore_episode(app, payload, user):
    # Validate/decompress everything before touching any existing records.
    manifest, pixels = _validate(payload)
    episode = copy.deepcopy(manifest["episode"])
    idmap = {frame["id"]: uuid.uuid4().hex for frame in manifest["frames"]}
    episode_id = "ep_" + uuid.uuid4().hex
    episode.update(id=episode_id, name=episode["name"][:100] + " (restored)",
                   frames=[idmap[fid] for fid in episode["frames"]], updatedAt=int(time.time() * 1000),
                   restoredBy=user, restoredAt=int(time.time() * 1000))
    mids = {r["measurement_id"]: uuid.uuid4().hex[:12] for r in manifest["history"].get("measurements.csv", [])}
    added = {}
    for name in app.FILES:
        added[name] = []
        for original in manifest["history"].get(name, []):
            row = dict(original, measurement_id=mids[original["measurement_id"]])
            if name == "measurements.csv":
                row["image_id"] = idmap[original["image_id"]]
            added[name].append(row)
    with app.LOCK:
        con = app.store_db()
        os.makedirs(app.RESULTS, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="episode-restore-", dir=app.DATA) as stage:
            published, old_csv = [], {}
            try:
                con.execute("BEGIN IMMEDIATE")
                now = int(time.time() * 1000)
                for frame in manifest["frames"]:
                    fid = idmap[frame["id"]]
                    for store in STORES:
                        record = copy.deepcopy(frame["records"].get(store))
                        if record is None:
                            continue
                        if store == "files":
                            record["id"] = fid
                        elif store in ("patches", "traces", "frameinfo"):
                            record["fileId"] = fid
                        elif store == "projects":
                            record["dashboardImageId"] = fid
                            record["episode"] = {"id": episode_id, "name": episode["name"], "frame": episode["frames"].index(fid) + 1}
                        # Review fingerprints depend on frame contents, not saved/restored IDs.
                        con.execute("INSERT INTO records VALUES (?,?,?,?)", (store, fid, _json(record).decode(), now))
                    for suffix, data in (("", pixels[frame["image"]]), (".type", str(frame["mime"]).encode())):
                        temp = os.path.join(stage, fid + suffix)
                        with open(temp, "wb") as fh:
                            fh.write(data)
                con.execute("INSERT INTO records VALUES (?,?,?,?)", ("episodes", episode_id, _json(episode).decode(), now))
                for name, columns in app.FILES.items():
                    dest = app.csv_path(name)
                    if os.path.isfile(dest):
                        with open(dest, "rb") as fh:
                            old_csv[dest] = fh.read()
                    else:
                        old_csv[dest] = None
                    rows = app.read_rows(name) + added[name]
                    with open(os.path.join(stage, name), "w", newline="", encoding="utf-8-sig") as fh:
                        writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
                        writer.writeheader()
                        writer.writerows(rows)
                for fid in idmap.values():
                    for suffix in ("", ".type"):
                        dest = os.path.join(app.IMAGES, fid + suffix)
                        os.replace(os.path.join(stage, fid + suffix), dest)
                        published.append(dest)
                for name in app.FILES:
                    os.replace(os.path.join(stage, name), app.csv_path(name))
                con.commit()
            except Exception:
                con.rollback()
                for dest in published:
                    if os.path.exists(dest):
                        os.remove(dest)
                for dest, previous in old_csv.items():
                    if previous is None:
                        if os.path.exists(dest):
                            os.remove(dest)
                    else:
                        with open(dest, "wb") as fh:
                            fh.write(previous)
                raise
            finally:
                con.close()
    return {"ok": True, "episode_id": episode_id, "frames": len(idmap), "measurements": len(mids)}
