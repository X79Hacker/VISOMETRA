/* Episode records are deliberately separate from image / drawing records. */
(function (root) {
  'use strict';
  const params = new URLSearchParams(location.search);
  const context = params.get('episode') || '';
  let pending = 0;
  async function request(method, id, data) {
    pending++;
    try {
      const r = await fetch('api/store/episodes' + (id ? '/' + encodeURIComponent(id) : ''), {
        method, cache: 'no-store', ...(data === undefined ? {} : {
          headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)
        })
      });
      if (r.status === 404 && method === 'GET' && id) return null;
      if (!r.ok) throw Error('Episode could not be saved or loaded (HTTP ' + r.status + ').');
      return r.json();
    } finally { pending--; }
  }
  function order(files, episode) {
    const byId = new Map(files.map(f => [f.id, f]));
    return (episode?.frames || []).map(id => byId.get(id)).filter(Boolean);
  }
  function link(path, episode = context) {
    if (!episode || episode === 'all' || episode === 'unassigned') return path;
    const url = new URL(path, location.href);
    url.searchParams.set('episode', episode);
    return url.pathname.split('/').pop() + url.search + url.hash;
  }
  const api = root.Episodes = {
    context, link, order,
    list: async () => (await request('GET')).records || [],
    get: id => request('GET', id),
    put: episode => request('PUT', episode.id, episode),
    remove: id => request('DELETE', id),
    async scoped(files) {
      if (!context) return files;
      const episode = await api.get(context);
      if (!episode) throw Error('This episode is unavailable. Return to the dashboard.');
      return order(files, episode);
    },
    async mount() {
      if (!context || (location.pathname.endsWith('dashboard-front.html')||location.pathname.endsWith('episode-lab.html'))) return;
      const episode = await api.get(context);
      if (!episode) return;
      const response = await fetch('api/store/files', {cache: 'no-store'});
      if (response.ok) {
        const live = new Set(((await response.json()).records || []).map(f => f.id));
        episode.frames = episode.frames.filter(id => live.has(id));
      }
      const banner = document.createElement('div'); banner.className = 'episode-context';
      const home = document.createElement('a'); home.href = link('dashboard-front.html'); home.textContent = '← Episode';
      const title = document.createElement('strong'); title.textContent = episode.name;
      const f = params.get('f'), index = episode.frames.indexOf(f);
      const status = document.createElement('span');
      status.textContent = index >= 0 ? 'Frame ' + (index + 1) + ' / ' + episode.frames.length : episode.frames.length + ' frames';
      const lab=document.createElement('a');lab.href=link('episode-lab.html'+(f?'?f='+encodeURIComponent(f):''));lab.textContent='Episode Lab';
      banner.append(home, title, status, lab);
      if (index >= 0 && !location.pathname.endsWith('outline-studio.html')) {
        for (const delta of [-1, 1]) {
          const b = document.createElement('button'); b.textContent = delta < 0 ? '← Previous frame' : 'Next frame →';
          b.disabled = !episode.frames[index + delta];
          b.onclick = () => {
            const url = new URL(location.href); url.searchParams.set('f', episode.frames[index + delta]);
            location.href = url.href;
          }; banner.append(b);
        }
      }
      document.body.prepend(banner);
      document.querySelectorAll('a[href]').forEach(a => {
        if (/^(dashboard-front|results|trace|editor|sector-map-matrix|outline-studio)\.html/.test(a.getAttribute('href'))) a.href = link(a.getAttribute('href'));
      });
    }
  };
  addEventListener('beforeunload', e => { if (pending) {e.preventDefault(); e.returnValue = '';} });
  addEventListener('DOMContentLoaded', () => api.mount().catch(error => console.error(error)));
})(window);
