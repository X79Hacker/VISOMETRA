/* Dashboard extension. Existing measurement and tracing code stays in place. */
window.EpisodeUI = (() => {
  'use strict';
  const state = {episodes: [], active: new URLSearchParams(location.search).get('episode') || 'all', selected: new Set(), busy: false, ready:false};
  const el = id => document.getElementById(id);
  const current = () => state.episodes.find(e => e.id === state.active);
  const owner = id => state.episodes.find(e => e.frames.includes(id));
  function frames() {
    if (current()) return Episodes.order(S.files, current());
    if (state.active === 'unassigned') return S.files.filter(f => !owner(f.id));
    return S.files;
  }
  function notice(message, error = false) { el('uploadNote').textContent = message; el('uploadNote').className = 'upload-note ' + (error ? 'err' : 'ok'); }
  async function action(fn) {
    if (state.busy) return;
    state.busy = true; render();
    try { await fn(); } catch (error) { notice(error.message, true); }
    finally { state.busy = false; window.render(); }
  }
  function button(text, onclick, className = '') {
    const b = document.createElement('button'); b.type = 'button'; b.textContent = text; b.className = className; b.onclick = onclick; return b;
  }
  function activate(id) {
    if (state.busy) return;
    state.active = id; state.selected.clear(); S.query = ''; el('search').value = ''; S.sort = 'sequence'; el('sort').value = 'sequence';
    const url = new URL(location.href); id === 'all' ? url.searchParams.delete('episode') : url.searchParams.set('episode', id);
    history.replaceState(null, '', url); window.render();
  }
  async function save(e) { e.updatedAt = Date.now(); await Episodes.put(e); }
  async function assign(ids, target) {
    // Save a removal before adding to the destination: failures never silently duplicate membership.
    for (const e of state.episodes) {
      if (e.id !== target && e.frames.some(id => ids.includes(id))) {
        const next = {...e, frames: e.frames.filter(id => !ids.includes(id))}; await save(next); Object.assign(e, next);
      }
    }
    const dest = state.episodes.find(e => e.id === target);
    if (dest) { const next = {...dest, frames: [...dest.frames, ...ids.filter(id => !dest.frames.includes(id))]}; await save(next); Object.assign(dest, next); }
  }
  function openDialog(edit = false) {
    const e = edit ? current() : null;
    el('episodeDialogTitle').textContent = e ? 'Edit episode' : 'Create an episode';
    el('episodeName').value = e?.name || ''; el('episodeNotes').value = e?.notes || '';
    el('episodeForm').dataset.edit = e?.id || ''; el('episodeError').textContent = '';
    el('episodeDialog').showModal(); el('episodeName').focus();
  }
  function frameTools(f) {
    const row = document.createElement('div'); row.className = 'frame-tools';
    const label = document.createElement('label'); label.className = 'frame-select';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = state.selected.has(f.id); check.disabled = state.busy;
    check.setAttribute('aria-label', 'Select ' + f.name); check.onchange = () => { check.checked ? state.selected.add(f.id) : state.selected.delete(f.id); render(); };
    label.onclick = event => event.stopPropagation(); label.append(check, document.createTextNode('Select'));
    const ep = owner(f.id), n = ep ? ep.frames.indexOf(f.id) + 1 : null;
    const badge = document.createElement('span'); badge.className = 'frame-number'; badge.textContent = n ? 'FRAME ' + String(n).padStart(3, '0') : 'UNASSIGNED';
    row.append(label, badge);
    const meta = document.createElement('div'); meta.className = 'episode-caption'; meta.textContent = ep?.name || 'Add to an episode to build a sequence';
    const wrapper = document.createElement('div'); wrapper.className = 'frame-episode'; wrapper.append(row, meta);
    if (current()) {
      const order = document.createElement('div'); order.className = 'frame-order';
      for (const delta of [-1, 1]) {
        const b = button(delta < 0 ? '← Earlier' : 'Later →', event => { event.stopPropagation(); action(async () => {
          const e = current(), a = e.frames.indexOf(f.id), b = a + delta;
          if (b < 0 || b >= e.frames.length) return;
          const next = {...e, frames: e.frames.slice()}; [next.frames[a], next.frames[b]] = [next.frames[b], next.frames[a]]; await save(next); Object.assign(e, next); S.sort = 'sequence'; el('sort').value = 'sequence';
        }); });
        b.disabled = state.busy || n + delta < 1 || n + delta > current().frames.length; order.append(b);
      }
      wrapper.append(order);
    }
    return wrapper;
  }
  function render() {
    if (!el('episodeList')) return;
    const list = el('episodeList'); list.replaceChildren();
    const nav = (name, id, count, subtitle) => {
      const b = button('', () => activate(id), 'episode-link' + (state.active === id ? ' active' : ''));
      b.disabled = state.busy; b.setAttribute('aria-current', state.active === id ? 'page' : 'false');
      const text = document.createElement('span'), title = document.createElement('strong'), sub = document.createElement('small'), num = document.createElement('em');
      title.textContent = name; sub.textContent = subtitle; num.textContent = count; text.append(title, sub); b.append(text, num); list.append(b);
    };
    nav('All images', 'all', S.files.length, 'Your complete workspace');
    nav('Unassigned', 'unassigned', S.files.filter(f => !owner(f.id)).length, 'Ready to organize');
    state.episodes.forEach((e, i) => nav(e.name, e.id, Episodes.order(S.files, e).length, 'EP ' + String(i + 1).padStart(2, '0') + ' · ordered sequence'));
    const e = current(), fs = frames();
    el('episodeTitle').textContent = e?.name || (state.active === 'unassigned' ? 'Ready for a new story.' : 'Every sequence. One workspace.');
    el('episodeDescription').textContent = e?.notes || (e ? 'Add related images here. Frame numbers follow your sequence order.' : 'Keep related images in episodes, then trace, measure and compare each frame.');
    el('episodeEyebrow').textContent = e ? 'EPISODE WORKSPACE / ' + fs.length + ' FRAMES' : 'SECTOR MAP / SEQUENCE WORKSPACE';
    el('episodeCount').textContent = state.episodes.length;
    el('imageCount').textContent = fs.length;
    el('measuredCount').textContent = fs.reduce((n, f) => n + measuredCount(f), 0).toLocaleString();
    el('episodeLab').hidden = !e; el('completeBackup').hidden = !e;
    el('episodeLab').disabled=state.busy;el('completeBackup').disabled=state.busy;
    el('episodeEdit').hidden = !e; el('episodeRemove').hidden = !e; el('episodeExport').hidden = !e; el('episodeStart').hidden = !e;
    el('episodeStart').disabled = state.busy || !fs.length;
    el('uploadDestination').textContent = e ? 'Adding to ' + e.name : 'Adding to Unassigned';
    el('selectionCount').textContent = state.selected.size + ' selected';
    const selectedTarget = el('moveTarget').value;
    el('moveTarget').replaceChildren(new Option('Move selected to…', ''), new Option('Unassigned', 'unassigned'), ...state.episodes.map(e => new Option(e.name, e.id)));
    el('moveTarget').value = selectedTarget;
    el('moveFrames').disabled = state.busy || !state.selected.size; el('clearSelection').disabled = !state.selected.size || state.busy;
    el('selectVisible').disabled = !fs.length || state.busy;
    el('newEpisode').disabled = state.busy; el('fileInput').disabled = state.busy||!state.ready;el('chooseFolder').disabled=state.busy||!state.ready;el('folderInput').disabled=state.busy||!state.ready;
    for (const id of ['episodeEdit', 'episodeRemove', 'episodeExport', 'uploadOrder', 'moveTarget', 'sort', 'search']) el(id).disabled = state.busy;
    // Studio imports up to 500 frames; inference is sequential and memory-bounded.
    el('studioEpisode').hidden = !e; el('studioEpisode').disabled = state.busy || !fs.length;
    el('empty').querySelector('strong').textContent = S.query ? 'No matching frames' : (e ? 'Your episode starts here.' : 'No images here yet.');
    el('emptyHint').textContent = S.query ? 'Try a different filename.' : 'Add images above, or select existing images and move them into this episode.';
    el('sequenceNote').textContent = e ? 'Sequence order is saved. Use Earlier / Later to adjust it.' : 'Create an episode to keep a related image sequence together.';
    document.querySelector('.topbar a[href^="results.html"]').href = Episodes.link('results.html', e?.id || '');
  }
  async function exportEpisode() {
    const e = current(), fs = frames(), {makeZip, csv, safeName} = await import('../studio/core.js');
    notice('Preparing episode export…');
    const response = await fetch('api/results', {cache: 'no-store'}); if (!response.ok) throw Error('Could not read saved measurements.');
    const data = await response.json(), rows = Array.isArray(data) ? data : data.rows || data.results || [];
    const index = new Map(fs.map((f, i) => [f.id, i + 1]));
    const measurements = rows.filter(r => index.has(r.image_id)).map(r => ({episode_id: e.id, episode_name: e.name, frame_number: index.get(r.image_id), ...r}));
    const manifest = {format: 'sector-map-episode-v1', exportedAt: new Date().toISOString(), episode: e, frames: fs.map((f, i) => ({frame: i + 1, image_id: f.id, filename: f.name, unit: f.unit, measured_cells: measuredCount(f)})), measurements};
    const headers = ['episode_id', 'episode_name', 'frame_number', 'image_id', 'image_name', 'scope', 'cell_row', 'cell_col', 'area_bezier', 'area_shoelace', 'area_fourier', 'perimeter', 'unit', 'saved_at', 'saved_by'];
    const frameRows = [['episode', 'frame', 'image_id', 'filename', 'measured_cells', 'unit'], ...fs.map((f, i) => [e.name, i + 1, f.id, f.name, measuredCount(f), f.unit])];
    const entries = [
      {name: 'episode.json', data: JSON.stringify(manifest, null, 2)},
      {name: 'frames.csv', data: csv(frameRows)},
      {name: 'measurements.csv', data: csv([headers, ...measurements.map(r => headers.map(k => r[k] ?? ''))])},
      {name: 'README.txt', data: 'Episode information export. Frame order is listed in frames.csv. Measurements include all saved legacy grid/trace records for these image IDs. Studio project files and source images are exported separately with their existing tools. This information ZIP is not an importable backup.\n'}
    ];
    download(makeZip(entries), safeName(e.name) + '-episode-info.zip'); notice('Episode information exported: frame order, notes and saved measurements.');
  }
  function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
  function setup() {
    el('episodeLab').onclick=()=>{location.href=Episodes.link('episode-lab.html',current().id);};
    el('completeBackup').onclick=()=>action(async()=>{notice('Preparing complete episode backup…');const {backupEpisode}=await import('./backup.js');await backupEpisode(current().id,current().name);notice('Complete episode backup downloaded.');});
    el('restoreEpisode').onclick=()=>el('episodeBackupFile').click();
    el('episodeBackupFile').onchange=()=>action(async()=>{const file=el('episodeBackupFile').files[0];if(!file)return;notice('Validating and restoring a new episode copy…');const {restoreBackup}=await import('./backup.js');const result=await restoreBackup(file);location.href=Episodes.link('episode-lab.html',result.episode_id);});
    el('newEpisode').onclick = () => openDialog(); el('episodeEdit').onclick = () => openDialog(true);
    el('episodeCancel').onclick = () => el('episodeDialog').close();
    el('episodeForm').onsubmit = event => {
      event.preventDefault(); if (state.busy) return;
      const name = el('episodeName').value.trim(); if (!name) {el('episodeError').textContent = 'Enter an episode name.'; return;}
      const existing = state.episodes.find(e => e.id === el('episodeForm').dataset.edit);
      const e = {...existing, id: existing?.id || 'ep_' + uid(), name, notes: el('episodeNotes').value.trim(), frames: existing?.frames || [], createdAt: existing?.createdAt || Date.now()};
      action(async () => { await save(e); existing ? Object.assign(existing, e) : state.episodes.push(e); state.active = e.id; state.selected.clear(); S.sort = 'sequence'; el('sort').value = 'sequence';
        const url = new URL(location.href); url.searchParams.set('episode', e.id); history.replaceState(null, '', url); el('episodeDialog').close(); notice('Episode saved. Add related images to begin.'); });
    };
    el('episodeRemove').onclick = () => { const e = current(); if (e && confirm('Remove episode “' + e.name + '”? Its images and measurements will stay available in Unassigned.')) action(async () => {await Episodes.remove(e.id); state.episodes = state.episodes.filter(x => x.id !== e.id); state.active = 'unassigned'; state.selected.clear(); const url = new URL(location.href); url.searchParams.set('episode', 'unassigned'); history.replaceState(null, '', url); notice('Episode removed. Images and measurements kept.');}); };
    el('moveFrames').onclick = () => action(async () => { const target = el('moveTarget').value; if (!target) throw Error('Choose the destination episode first.'); await assign([...state.selected], target); state.selected.clear(); notice('Frames moved. Their drawings and measurements are kept.'); });
    el('selectVisible').onclick = () => { visible().forEach(f => state.selected.add(f.id)); window.render(); };
    el('clearSelection').onclick = () => { state.selected.clear(); window.render(); };
    el('episodeExport').onclick = () => action(exportEpisode);
    el('episodeStart').onclick = () => { if (frames()[0]) location.href = Episodes.link('trace.html?f=' + encodeURIComponent(frames()[0].id), state.active); };
    el('studioEpisode').onclick = () => {
      if (frames().length > 20) {notice('Studio supports up to 20 images per queue. Open individual frames, or use a smaller episode.', true); return;}
      location.href = Episodes.link('outline-studio.html?queue=episode', state.active);
    };
    el('fileInput').addEventListener('change', () => {state.selected.clear();});
  }
  return {state, current, frames, owner, frameTools, render, setup, notice, assign, link: path => Episodes.link(path, current()?.id || ''),
    async load() { state.episodes = (await Episodes.list()).filter(e => e && e.id && typeof e.name === 'string' && Array.isArray(e.frames)); if (!['all', 'unassigned'].includes(state.active) && !current()) state.active = 'all'; },
    prune() { state.ready=true;const live = new Set(S.files.map(f => f.id)); state.episodes.forEach(e => {e.frames = [...new Set(e.frames)].filter(id => live.has(id));}); },
    async uploaded(ids, target) { await assign(ids, target); },
    async uploading(files, perform) { if(!state.ready){notice('Wait for the episode workspace to finish loading.');return;}if (state.busy) return; await action(async () => { const list = Array.from(files);if(list.length+(current()?.frames.length||0)>500)throw Error('Use up to 500 images per episode. Import a smaller folder or create another episode.');if(list.some(f=>f.size>25*1024*1024))throw Error('Each image must be below 25 MB.'); if (el('uploadOrder').value === 'name') list.sort((a, b) => (a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name, undefined, {numeric: true, sensitivity: 'base'})); await perform(list, current()?.id || ''); }); },
    compare(a, b) { const e = current(); return e ? e.frames.indexOf(a.id) - e.frames.indexOf(b.id) : (b.createdAt || 0) - (a.createdAt || 0); }
  };
})();
