export async function backupStatus() {
  const response=await fetch('api/episodes/status',{cache:'no-store'});
  if(!response.ok)throw Error('Start the updated Python server to use complete backups.');
  const status=await response.json();if(!status.backups)throw Error(status.message||'Complete backups use the local Python server.');return status;
}
export function download(blob,name) {const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
export async function backupEpisode(id,name='episode') {
  await backupStatus();const r=await fetch('api/episodes/backup?id='+encodeURIComponent(id),{cache:'no-store'});
  if(!r.ok)throw Error((await r.json()).error||'Could not create backup.');
  download(await r.blob(),name.replace(/[^a-zA-Z0-9_-]+/g,'_').slice(0,80)+'-complete-backup.zip');
}
export async function restoreBackup(file) {
  if(!file)return null;const status=await backupStatus();if(file.size>status.max_archive_bytes)throw Error('Backup ZIP must be below 256 MB.');
  const r=await fetch('api/episodes/restore',{method:'POST',headers:{'Content-Type':'application/zip'},body:file});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Could not restore backup.');return data;
}
