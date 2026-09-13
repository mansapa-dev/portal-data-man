(() => {
  const key = 'mansapa-dashboard-theme';
  let saved; try { saved = localStorage.getItem(key); } catch (_) {}
  const system = matchMedia('(prefers-color-scheme: dark)');
  function apply(theme) {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
      button.setAttribute('aria-label', theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap');
      button.title = button.getAttribute('aria-label');
    });
  }
  apply(saved === 'dark' || saved === 'light' ? saved : system.matches ? 'dark' : 'light');
  document.addEventListener('DOMContentLoaded', () => {
    apply(document.documentElement.dataset.theme);
    document.querySelectorAll('[data-theme-toggle]').forEach(button => button.addEventListener('click', () => {
      saved = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      apply(saved); try { localStorage.setItem(key, saved); } catch (_) {}
    }));
    document.querySelectorAll('.dashboard-metric-action').forEach(card => card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); card.click(); }
    }));
  });
  system.addEventListener('change', event => { if (!saved) apply(event.matches ? 'dark' : 'light'); });
})();
