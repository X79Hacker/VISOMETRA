/* Shared storage: every page's reads and writes go to the server, so all
   users see the same images, cell drawings and traces.

   Each page keeps its own storeReq(name, mode, method, arg) over IndexedDB
   (stores files / patches / traces); it now calls
       const storeReq = SharedStore.wrap(localStoreReq);
   and the same calls are answered by api/store/... instead —
   functions/api/store/[[path]].js on Cloudflare, server.py locally.
   IndexedDB stays as a cache of the image pixels, which never change for an
   image id, so each image is downloaded once per browser.

   Images found only in this browser (from before storage was shared) are
   uploaded on the first file list. Images someone deleted are removed from
   the cache. Opened straight from disk (file://) everything stays local. */
(function(){
"use strict";

const API = 'api/store/';
const MAX_IMAGE = 25 * 1024 * 1024;
const onServer = new Set();   // image ids whose pixels are already on the server
const queues = new Map();     // record key -> pending save (only the latest one is sent)

async function call(method, path, body, type){
  const opts = { method, cache:'no-store' };
  if(body !== undefined){ opts.body = body; opts.headers = {'Content-Type': type}; }
  const r = await fetch(API + path, opts);
  if(r.status === 404 && method === 'GET') return null;
  if(r.status === 410) return null;   // the image was deleted by someone: nothing to save
  if(!r.ok){
    let msg = '';
    try{ msg = (await r.json()).error || ''; }catch(e){}
    throw new Error('shared storage: ' + (msg || ('HTTP ' + r.status)));
  }
  return r;
}
async function getJSON(path){ const r = await call('GET', path); return r ? r.json() : undefined; }

/* Saves of one record run one at a time; while one is on its way, newer
   saves replace each other and only the latest is sent next. Each promise
   resolves once a save at least as new as it has reached the server. */
function saveLatest(key, send){
  let q = queues.get(key);
  if(!q){ q = { busy:false, next:null }; queues.set(key, q); }
  if(!q.busy) return run(key, q, send);
  if(!q.next){
    let resolve, reject;
    const promise = new Promise((a, b) => { resolve = a; reject = b; });
    q.next = { send, promise, resolve, reject };
  } else q.next.send = send;
  return q.next.promise;
}
function run(key, q, send){
  q.busy = true;
  const p = send();
  p.catch(() => {}).then(() => {
    q.busy = false;
    const n = q.next; q.next = null;
    if(n) run(key, q, n.send).then(n.resolve, n.reject);
    else queues.delete(key);
  });
  return p;
}
function putRecord(path, rec){
  const body = JSON.stringify(rec);   // taken now: later changes to rec belong to a later save
  return saveLatest(path, () => call('PUT', path, body, 'application/json'));
}

/* Cell drawings are sent and stored compactly. A measured cell used to carry
   its circles three times (coeffs, active, tableData) with 17-digit numbers —
   about 70 KB per cell, 14 MB for a fully measured image, sent again on every
   save. Now only the circles are stored, as [k, re, im] with 12 significant
   digits, plus how many are shown (nA); outline points keep 6 decimals (well
   below a millionth of a pixel). amplitude, phase, active and tableData are
   rebuilt on load exactly as the editor's worker computes them, so the pages
   see the same records as before. Older records are read as they are. */
const sig = v => (typeof v === 'number' && isFinite(v) && !Number.isInteger(v)) ? Number(v.toPrecision(12)) : v;
const px  = v => (typeof v === 'number' && isFinite(v) && !Number.isInteger(v)) ? Math.round(v * 1e6) / 1e6 : v;
const roundDeep = (v, f) => Array.isArray(v) ? v.map(x => roundDeep(x, f))
  : (v && typeof v === 'object') ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, roundDeep(x, f)])) : f(v);

function packPatch(p){
  if(!p || typeof p !== 'object' || !Array.isArray(p.coeffs)) {
    return p && typeof p === 'object' && (p.points || p.bezier)
      ? Object.assign({}, p, p.points ? { points: roundDeep(p.points, px) } : null, p.bezier ? { bezier: roundDeep(p.bezier, px) } : null)
      : p;
  }
  const out = {};
  for(const k in p){
    if(k === 'coeffs' || k === 'active' || k === 'tableData') continue;
    out[k] = (k === 'points' || k === 'bezier' || k === 'centroid') ? roundDeep(p[k], px) : p[k];
  }
  out.cf = p.coeffs.map(c => [c.k, sig(c.re), sig(c.im)]);
  if(Array.isArray(p.active) && p.active.length !== p.coeffs.length) out.nA = p.active.length;
  if(!p.active) out.nA = -1;            // circles computed but no active list
  if(!p.tableData) out.noTable = true;
  return out;
}
function unpackPatch(p){
  if(!p || typeof p !== 'object' || !Array.isArray(p.cf)) return p;
  const out = {};
  for(const k in p) if(k !== 'cf' && k !== 'nA' && k !== 'noTable') out[k] = p[k];
  const coeffs = p.cf.map(([k, re, im]) => ({ k, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) }));
  out.coeffs = coeffs;
  out.active = p.nA === -1 ? null : coeffs.slice(0, p.nA == null ? coeffs.length : p.nA).map(c => ({ k: c.k, amp: c.amp, phase: c.phase }));
  if(p.noTable) out.tableData = null;
  else {
    let cum = 0;
    out.tableData = coeffs.map((c, i) => {
      cum += c.k * c.amp * c.amp;
      return { rank: i + 1, k: c.k, amp: c.amp, phase: c.phase, phaseDeg: c.phase * 180 / Math.PI, cumArea: Math.abs(Math.PI * cum) };
    });
  }
  return out;
}
function packPatches(rec){
  if(!rec || !Array.isArray(rec.patches)) return rec;
  return Object.assign({}, rec, { patches: rec.patches.map(packPatch) });
}
function unpackPatches(rec){
  if(!rec || !Array.isArray(rec.patches)) return rec;
  rec.patches = rec.patches.map(unpackPatch);
  return rec;
}

function details(rec){
  const m = Object.assign({}, rec);
  delete m.blob;
  return m;
}
const enc = encodeURIComponent;

async function uploadImage(rec){
  if(!rec.blob) return;
  if(rec.blob.size > MAX_IMAGE) throw new Error('"' + rec.name + '" is larger than 25 MB, the limit for shared images');
  await call('PUT', 'blob/' + enc(rec.id), rec.blob, rec.blob.type || 'application/octet-stream');
  onServer.add(rec.id);
}

async function withPixels(local, meta){
  onServer.add(meta.id);
  let cached = null;
  try{ cached = await local('files', 'readonly', 'get', meta.id); }catch(e){}
  let blob = cached && cached.blob;
  if(!blob){
    const r = await call('GET', 'blob/' + enc(meta.id));
    blob = r ? await r.blob() : null;
  }
  const rec = Object.assign({}, meta, { blob });
  if(blob){ try{ await local('files', 'readwrite', 'put', rec); }catch(e){} }
  return rec;
}

async function dropLocal(local, id){
  for(const s of ['files', 'patches', 'traces']){
    try{ await local(s, 'readwrite', 'delete', id); }catch(e){}
  }
}

async function allFiles(local){
  const res = await getJSON('files');
  const records = res.records, gone = new Set(res.deleted || []);
  const have = new Set(records.map(r => r.id));
  let cached = [];
  try{ cached = await local('files', 'readonly', 'getAll'); }catch(e){}
  for(const c of cached){
    if(!c || !c.id) continue;
    if(gone.has(c.id)){ await dropLocal(local, c.id); continue; }
    if(have.has(c.id) || !c.blob) continue;
    // only in this browser: from before storage was shared, so upload it with its drawings
    await uploadImage(c);
    await putRecord('files/' + enc(c.id), details(c));
    for(const s of ['patches', 'traces']){
      let r = null;
      try{ r = await local(s, 'readonly', 'get', c.id); }catch(e){}
      if(r) await putRecord(s + '/' + enc(c.id), s === 'patches' ? packPatches(r) : r);
    }
    records.push(details(c));
  }
  return Promise.all(records.map(m => withPixels(local, m)));
}

async function shared(local, name, method, arg){
  if(name === 'files'){
    switch(method){
      case 'getAll': return allFiles(local);
      case 'get': {
        const meta = await getJSON('files/' + enc(arg));
        return meta ? withPixels(local, meta) : undefined;
      }
      case 'put':
        if(!onServer.has(arg.id)) await uploadImage(arg);
        await putRecord('files/' + enc(arg.id), details(arg));
        try{ await local('files', 'readwrite', 'put', arg); }catch(e){}
        return arg.id;
      case 'delete':
        await call('DELETE', 'files/' + enc(arg));
        onServer.delete(arg);
        await dropLocal(local, arg);
        return undefined;
      case 'clear':
        await call('DELETE', 'files');
        onServer.clear();
        for(const s of ['files', 'patches', 'traces']){ try{ await local(s, 'readwrite', 'clear'); }catch(e){} }
        return undefined;
    }
  } else if(name === 'patches' || name === 'traces'){
    const pk = name === 'patches';
    switch(method){
      case 'get':    { const r = await getJSON(name + '/' + enc(arg)); return pk ? unpackPatches(r) : r; }
      case 'getAll': { const rs = (await getJSON(name)).records; return pk ? rs.map(unpackPatches) : rs; }
      case 'put':    await putRecord(name + '/' + enc(arg.fileId), pk ? packPatches(arg) : arg); return arg.fileId;
      case 'delete': await call('DELETE', name + '/' + enc(arg)); return undefined;
      case 'clear':  await call('DELETE', name); return undefined;
    }
  }
  return local(name, method === 'get' || method === 'getAll' ? 'readonly' : 'readwrite', method, arg);
}

window.SharedStore = {
  saveDocument(path, record){ return putRecord(path, record).then(r=>{if(!r)throw Error('This image was deleted. Download a portable project to keep your edits.');return r;}); },
  wrap(local){
    if(location.protocol === 'file:') return local;
    return (name, mode, method, arg) => shared(local, name, method, arg);
  },
  /* The image list only — id, name, createdAt, calibration — without pixels or
     drawings: one small request. Pages that show a single image (editor, matrix,
     trace) use this instead of files getAll, which also fetches every image. */
  async list(local){
    if(location.protocol === 'file:'){
      const all = await local('files', 'readonly', 'getAll');
      return all.map(details);
    }
    const res = await getJSON('files');
    return (res && res.records) || [];
  }
};

// a save still on its way would be lost by closing or leaving the page
window.addEventListener('beforeunload', e => {
  if(queues.size){ e.preventDefault(); e.returnValue = ''; }
});
})();
