import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/episodes/store.js', import.meta.url), 'utf8');
function setup(search = '?episode=ep_a') {
  const records = new Map();
  const sandbox = {URL, URLSearchParams, Set, Map, console, location:{search,href:'http://localhost/trace.html'+search,pathname:'/trace.html'},addEventListener(){}};
  sandbox.window = sandbox;
  sandbox.fetch = async (url, options) => {
    const id = url.split('/')[3];
    if (options.method === 'PUT') records.set(id, JSON.parse(options.body));
    if (options.method === 'DELETE') records.delete(id);
    const found = options.method === 'GET' ? (id ? records.get(id) : {records:[...records.values()]}) : {ok:true};
    return {status:found ? 200 : 404,ok:!!found,json:async()=>found};
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.Episodes;
}
test('episode records roundtrip independently of image records and preserve notes and frame order', async()=>{
  const api = setup();
  await api.put({id:'ep_a',name:'Room',notes:'Capture session',frames:['f10','f1']});
  await api.put({id:'ep_b',name:'Corridor',frames:['f2']});
  assert.equal((await api.get('ep_a')).notes,'Capture session');
  assert.deepEqual(JSON.parse(JSON.stringify(await api.scoped([{id:'f1'},{id:'f2'},{id:'f10'}]))),[{id:'f10'},{id:'f1'}]);
  await api.remove('ep_b');
  assert.equal((await api.list()).length,1);
  assert.equal((await api.get('ep_a')).frames.length,2);
});
test('navigation carries the episode alongside existing image and cell coordinates',()=>{
  const api=setup();
  assert.equal(api.link('editor.html?f=f1&c=17'),'editor.html?f=f1&c=17&episode=ep_a');
  assert.equal(api.link('dashboard-front.html'),'dashboard-front.html?episode=ep_a');
  assert.equal(api.link('editor.html?f=f1&c=17',''),'editor.html?f=f1&c=17');
});
test('missing episode fails clearly; unscoped image lists keep their original order',async()=>{
  await assert.rejects(setup().scoped([{id:'f1'}]),/unavailable/);
  const files=[{id:'f2'},{id:'f1'}];
  assert.equal(await setup('').scoped(files),files);
});
