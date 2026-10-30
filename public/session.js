/* The logged-in user, for every page (load before the page's own script).

   login.html stores the username in localStorage ('dash-user', also used as
   'db-name' for "saved by"), so pages can show it immediately; this script
   then asks the server (api/me) who is really logged in and corrects the
   stored name if it differs. If the session has ended, it goes to the login
   page. Session.logout() is the dashboard's Terminate button.

   window.Session.user  — the username (string)
   Session.stamp(obj)   — sets obj.editedBy / obj.editedAt, for anything the user changes
   Session.logout()     — ends the session and opens the login page */
(function(){
"use strict";

let user = '';
try{ user = localStorage.getItem('dash-user') || ''; }catch(e){}

function remember(name){
  user = name;
  try{ localStorage.setItem('dash-user', name); localStorage.setItem('db-name', name); }catch(e){}
  document.querySelectorAll('#onlineUser, [data-session-user]').forEach(el => { el.textContent = name; });
  window.dispatchEvent(new CustomEvent('session-user', { detail: name }));
}
function toLogin(){
  location.replace('login.html?next=' + encodeURIComponent(location.pathname + location.search));
}

window.Session = {
  get user(){ return user; },
  stamp(obj){
    if(obj && typeof obj === 'object'){ obj.editedBy = user || 'unknown'; obj.editedAt = Date.now(); }
    return obj;
  },
  async logout(){
    try{ await fetch('api/logout', { method:'POST', cache:'no-store' }); }catch(e){}
    try{ localStorage.removeItem('dash-user'); localStorage.removeItem('db-name'); }catch(e){}
    location.replace('login.html');
  },
  ready: null
};

// opened straight from disk: there is no server and no login
if(location.protocol === 'file:'){ window.Session.ready = Promise.resolve(user); return; }

window.Session.ready = fetch('api/me', { cache:'no-store' }).then(async r => {
  if(r.status === 401){ toLogin(); return user; }
  const j = await r.json().catch(() => ({}));
  if(j.user && j.user !== user) remember(j.user);
  else if(j.user) document.querySelectorAll('[data-session-user]').forEach(el => { el.textContent = j.user; });
  return user;
}).catch(() => user);
})();
