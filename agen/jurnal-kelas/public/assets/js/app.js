export const csrfToken=()=>document.querySelector('meta[name="csrf-token"]')?.content??'';

// The navigation is rendered by PHP on authenticated pages, so bind it with
// event delegation after the document is ready. This keeps the mobile drawer
// usable even when a page has no page-specific JavaScript.
document.addEventListener('DOMContentLoaded',()=>{
  const body=document.body;
  const setMenu=(open)=>{
    body.classList.toggle('page-menu-open',open);
    document.querySelector('.page-nav-toggle')?.setAttribute('aria-expanded',String(open));
  };
  document.addEventListener('click',event=>{
    const target=event.target;
    if(!(target instanceof Element))return;
    if(target.closest('.page-nav-toggle')){event.preventDefault();setMenu(!body.classList.contains('page-menu-open'));return;}
    if(target.closest('.page-nav-close,.page-nav-scrim,.page-nav-links a'))setMenu(false);
  });
  document.addEventListener('keydown',event=>{if(event.key==='Escape')setMenu(false)});
});
