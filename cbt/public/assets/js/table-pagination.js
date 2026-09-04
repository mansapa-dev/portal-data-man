(function () {
  'use strict';

  const PAGE_SIZE = 10;
  const states = new WeakMap();
  let scanQueued = false;

  function rowsOf(table) {
    const body = table.tBodies[0];
    return body ? Array.from(body.rows) : [];
  }

  function pagerHost(table) {
    const wrapper = table.closest('.table-responsive, .teacher-result-table');
    return wrapper || table;
  }

  function render(table, requestedPage) {
    if (!table.isConnected || table.closest('.follow-up-table')) return;
    const rows = rowsOf(table);
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, requestedPage), pages);
    let state = states.get(table);

    if (!state) {
      const pager = document.createElement('nav');
      pager.className = 'table-pagination universal-table-pagination';
      pager.setAttribute('aria-label', 'Navigasi halaman tabel');
      pagerHost(table).insertAdjacentElement('afterend', pager);
      state = { page: 1, pager, rowCount: rows.length };
      states.set(table, state);
    }

    state.page = page;
    state.rowCount = rows.length;
    const start = (page - 1) * PAGE_SIZE;
    rows.forEach((row, index) => { row.hidden = index < start || index >= start + PAGE_SIZE; });

    if (rows.length <= PAGE_SIZE) {
      state.pager.replaceChildren();
      state.pager.hidden = true;
      return;
    }

    state.pager.hidden = false;
    const info = document.createElement('span');
    info.textContent = `Menampilkan ${start + 1}–${Math.min(start + PAGE_SIZE, rows.length)} dari ${rows.length} data`;
    const controls = document.createElement('div');
    const previous = document.createElement('button');
    previous.type = 'button'; previous.innerHTML = '&lt;'; previous.disabled = page === 1;
    previous.setAttribute('aria-label', 'Halaman sebelumnya');
    previous.addEventListener('click', () => render(table, page - 1));
    const label = document.createElement('b');
    label.textContent = `Halaman ${page} / ${pages}`;
    const next = document.createElement('button');
    next.type = 'button'; next.innerHTML = '&gt;'; next.disabled = page === pages;
    next.setAttribute('aria-label', 'Halaman berikutnya');
    next.addEventListener('click', () => render(table, page + 1));
    controls.append(previous, label, next);
    state.pager.replaceChildren(info, controls);
  }

  function scan(resetChangedTables = false) {
    document.querySelectorAll('.dash-tab table, .dashboard-page #content table').forEach((table) => {
      if (table.closest('.follow-up-table')) return;
      const state = states.get(table);
      const count = rowsOf(table).length;
      render(table, resetChangedTables ? 1 : (state?.page || 1));
    });
  }

  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => { scanQueued = false; scan(true); });
  }

  const observer = new MutationObserver((mutations) => {
    const needsScan = mutations.some((mutation) => {
      if (mutation.target.closest?.('.universal-table-pagination')) return false;
      if (mutation.target.closest?.('tbody')) return true;
      return Array.from(mutation.addedNodes).some((node) => node.nodeType === 1 && (node.matches?.('table') || node.querySelector?.('table')));
    });
    if (needsScan) queueScan();
  });

  function start() {
    scan();
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
