(function(){
  'use strict';
  const STATUS_URL='/api/auth/status';
  const LOGIN_URL='/login?logged_out=1';
  const STORAGE_KEY='agen.logout.at';
  const logoutForms=()=>Array.from(document.querySelectorAll('form[action="/logout"]'));
  let redirecting=false;
  let channel=null;

  function showSigningOut(){
    if(document.getElementById('agen-signing-out'))return;
    const overlay=document.createElement('div');
    overlay.id='agen-signing-out';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','assertive');
    overlay.textContent='Mengakhiri sesi…';
    overlay.style.cssText='position:fixed;inset:0;z-index:10000;display:grid;place-items:center;background:rgba(245,245,249,.94);color:#5558e8;font:700 15px Inter,Segoe UI,sans-serif;';
    document.body.append(overlay);
  }

  async function authenticated(){
    try{
      const response=await fetch(STATUS_URL,{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
      const body=await response.json();
      return response.ok&&body.data?.authenticated===true;
    }catch(_error){
      return null;
    }
  }

  async function redirectWhenLoggedOut(){
    if(redirecting||!logoutForms().length)return;
    redirecting=true;showSigningOut();
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      const active=await authenticated();
      if(active===false){location.replace(LOGIN_URL);return;}
      await new Promise(resolve=>setTimeout(resolve,200));
    }
    redirecting=false;document.getElementById('agen-signing-out')?.remove();
  }

  async function verifySession(){
    if(redirecting||!logoutForms().length)return;
    if(await authenticated()===false){redirecting=true;location.replace(LOGIN_URL);}
  }

  function announceLogout(){
    showSigningOut();
    try{localStorage.setItem(STORAGE_KEY,String(Date.now()));}catch(_error){}
    channel?.postMessage('logout');
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const forms=logoutForms();
    if(!forms.length)return;
    try{channel='BroadcastChannel'in window?new BroadcastChannel('agen-auth'):null;}catch(_error){channel=null;}
    channel?.addEventListener('message',event=>{if(event.data==='logout')redirectWhenLoggedOut();});
    window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY)redirectWhenLoggedOut();});
    forms.forEach(form=>form.addEventListener('submit',()=>{
      const button=form.querySelector('button[type="submit"]');
      if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
      announceLogout();
    }));
    window.addEventListener('pageshow',verifySession);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')verifySession();});
    window.setInterval(verifySession,15000);
  });
})();
