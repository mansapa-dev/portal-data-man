export const csrfToken=()=>document.querySelector('meta[name="csrf-token"]')?.content??'';

// The navigation is rendered by PHP on authenticated pages, so bind it with
// event delegation after the document is ready. This keeps the mobile drawer
// usable even when a page has no page-specific JavaScript. This is the single
// owner of the mobile menu state.
//
// Two shells exist:
//  - ".page-nav-*" workspace shell  -> body class "page-menu-open"
//  - ".app-shell" dashboard sidebar -> body class "menu-open"
document.addEventListener('DOMContentLoaded',()=>{
  const shells={
    workspace:{menu:'page-menu-open',toggle:'.page-nav-toggle'},
    sidebar:{menu:'menu-open',toggle:'.menu-toggle'}
  };
  const kinds=Object.keys(shells);
  const closeTriggers='.page-nav-close,.page-nav-scrim,.page-nav-links a,.sidebar-close,.sidebar-scrim,.side-nav a';
  const isOpen=(kind)=>document.body.classList.contains(shells[kind].menu);
  const setMenu=(kind,open)=>{
    document.body.classList.toggle(shells[kind].menu,open);
    const toggle=document.querySelector(shells[kind].toggle);
    toggle?.setAttribute('aria-expanded',String(open));
    toggle?.setAttribute('aria-label',open?'Tutup menu':'Buka menu');
  };
  document.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    const kind=kinds.find(k=>target.closest(shells[k].toggle));
    if(kind){event.preventDefault();setMenu(kind,!isOpen(kind));return;}
    if(target.closest(closeTriggers))kinds.forEach(k=>{if(isOpen(k))setMenu(k,false)});
  });
  document.addEventListener('keydown',event=>{
    if(event.key!=='Escape')return;
    kinds.forEach(k=>{if(isOpen(k))setMenu(k,false)});
  });
});
