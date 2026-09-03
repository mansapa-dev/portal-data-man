const menuButton = document.querySelector('.menu-toggle');
const closeButton = document.querySelector('.sidebar-close');
const scrim = document.querySelector('.sidebar-scrim');

function toggleMenu(open) {
    document.body.classList.toggle('menu-open', open);
    menuButton?.setAttribute('aria-expanded', String(open));
}

menuButton?.addEventListener('click', () => toggleMenu(true));
closeButton?.addEventListener('click', () => toggleMenu(false));
scrim?.addEventListener('click', () => toggleMenu(false));
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') toggleMenu(false);
});
