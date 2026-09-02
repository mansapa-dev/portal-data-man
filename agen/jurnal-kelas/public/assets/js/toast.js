(function(){
  const STORAGE_KEY='agen.flash';
  function ensureRegion(){
    let region=document.querySelector('#agen-toast-region');
    if(!region){region=document.createElement('div');region.id='agen-toast-region';region.className='toast-region';region.setAttribute('aria-live','polite');region.setAttribute('aria-atomic','true');document.body.append(region)}
    return region;
  }
  function show(message,type='success',options={}){
    if(options.persist){sessionStorage.setItem(STORAGE_KEY,JSON.stringify({message,type}));return}
    const toast=document.createElement('div');toast.className=`agen-toast toast-${type}`;toast.setAttribute('role',type==='error'?'alert':'status');toast.innerHTML=`<span class="toast-icon" aria-hidden="true">${type==='success'?'✓':type==='error'?'!':'i'}</span><div><strong>${type==='success'?'Berhasil':type==='error'?'Terjadi kendala':'Informasi'}</strong><p></p></div><button type="button" aria-label="Tutup notifikasi">×</button>`;toast.querySelector('p').textContent=message;const close=()=>{toast.classList.add('toast-leave');setTimeout(()=>toast.remove(),220)};toast.querySelector('button').addEventListener('click',close);ensureRegion().append(toast);requestAnimationFrame(()=>toast.classList.add('toast-visible'));setTimeout(close,options.duration??4500)
  }
  window.AgenToast={show,success:(message,options)=>show(message,'success',options),error:(message,options)=>show(message,'error',options),info:(message,options)=>show(message,'info',options)};
  document.addEventListener('DOMContentLoaded',()=>{try{const flash=JSON.parse(sessionStorage.getItem(STORAGE_KEY));if(flash?.message){sessionStorage.removeItem(STORAGE_KEY);show(flash.message,flash.type)}}catch{sessionStorage.removeItem(STORAGE_KEY)}
    const toggle=document.querySelector('.page-nav-toggle'),close=document.querySelector('.page-nav-close'),scrim=document.querySelector('.page-nav-scrim');
    const setMenu=open=>{document.body.classList.toggle('page-menu-open',open);toggle?.setAttribute('aria-expanded',String(open))};
    toggle?.addEventListener('click',()=>setMenu(true));close?.addEventListener('click',()=>setMenu(false));scrim?.addEventListener('click',()=>setMenu(false));
    document.querySelectorAll('.page-nav-links a').forEach(link=>link.addEventListener('click',()=>setMenu(false)));
    document.addEventListener('keydown',event=>{if(event.key==='Escape')setMenu(false)});
  });
})();
