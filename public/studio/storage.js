let opening;
function db(){return opening??=new Promise((resolve,reject)=>{const r=indexedDB.open('sector-map-outline-studio-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('projects');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
export async function saveAutosave(project){const database=await db();return new Promise((resolve,reject)=>{const tx=database.transaction('projects','readwrite');tx.objectStore('projects').put(project,'last');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export async function readAutosave(){const database=await db();return new Promise((resolve,reject)=>{const r=database.transaction('projects').objectStore('projects').get('last');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
