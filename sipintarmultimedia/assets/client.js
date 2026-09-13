window.sipEscape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
(() => {
    const session = window.sipSession;
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (resource, options = {}) => {
        const url = new URL(typeof resource === 'string' ? resource : resource.url, location.href);
        if (url.origin !== location.origin || url.pathname !== session.base + '/api.php') return originalFetch(resource, options);
        options = {...options, headers: new Headers(options.headers)};
        if ((options.method || 'GET').toUpperCase() === 'POST') {
            options.headers.set('X-CSRF-Token', session.csrf);
            if (typeof options.body === 'string' && url.searchParams.get('action') === 'simpan_transaksi') {
                const data = JSON.parse(options.body);
                const field = document.getElementById(data.tipe === 'MASUK' ? 'bm_petugas' : 'nama_pengambil');
                if (field?.dataset.employeeId) data.employee_id = field.dataset.employeeId;
                options.body = JSON.stringify(data);
            }
        }
        const response = await originalFetch(resource, options);
        if (url.searchParams.get('action') === 'login' && response.ok) {
            const result = await response.clone().json();
            if (result.success) { session.csrf = result.csrf; location.reload(); }
        }
        return response;
    };
    document.addEventListener('DOMContentLoaded', () => {
        if (!session.user) return;
        sessionStorage.setItem('sipintar_user', session.user.name);
        const can = permission => session.permissions.includes(permission);
        if (session.app === 'sipintar' && location.pathname.endsWith('/index.php') && !can('transactions.read') && can('transactions.create')) { location.replace('pengunjung.php'); return; }
        const nav = document.createElement('nav');
        nav.style.cssText = 'padding:10px;text-align:center;background:#edf7f1;font:14px system-ui;color:#145339';
        const links = [['index.php', 'Beranda']];
        if (session.user.superadmin) links.push(['admin.php', 'Kelola akun & role']);
        for (const [href, label] of links) { const a = document.createElement('a'); a.href = href; a.textContent = label; a.style.margin = '0 10px'; nav.append(a); }
        if (location.pathname.endsWith('/pengunjung.php')) {
            const button = document.createElement('button'); button.textContent = 'Keluar';
            button.onclick = async () => { await fetch('api.php?action=logout', {method:'POST'}); location.href='index.php'; }; nav.append(button);
        }
        document.body.prepend(nav);
        const restrictions = session.app === 'sipintar' ? {
            'tab-form':'transactions.create', 'tab-barang-masuk':'transactions.manage',
            'tab-master-barang':'inventory.manage', 'tab-history':'transactions.read'
        } : {};
        for (const [id, permission] of Object.entries(restrictions)) if (!can(permission)) document.getElementById(id)?.remove();
        const hideActions = () => {
            for (const element of document.querySelectorAll('[onclick]')) {
                const action = element.getAttribute('onclick') || '';
                if (session.app === 'sipintar' && !can('transactions.manage') && /editTransaksi|handleHapus/.test(action)) element.hidden = true;
                if (session.app === 'multimedia' && ((!can('borrowings.manage') && /editModal|openEditModal/.test(action)) || (!can('borrowings.create') && /openModal\(/.test(action)))) element.hidden = true;
            }
        };
        hideActions(); new MutationObserver(hideActions).observe(document.body, {childList:true,subtree:true});
        for (const field of document.querySelectorAll('#nama_pengambil, #bm_petugas, [name="borrowerName"]')) {
            const form = field.closest('form'); if (!form) continue;
            const manager = can(session.app === 'multimedia' ? 'borrowings.manage' : 'transactions.manage');
            field.readOnly = true;
            if (!field.id.startsWith('edit_')) field.value = session.user.name;
            if (!manager) continue;
            const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Cari pegawai Portal Data'; search.className = field.className;
            const select = document.createElement('select'); select.className = field.className; select.add(new Option('Pilih pegawai (opsional)', ''));
            const hidden = document.createElement('input'); hidden.type='hidden'; hidden.name='employee_id'; form.append(hidden);
            field.after(search, select);
            let timer, sequence = 0, employees = [];
            search.addEventListener('input', () => {
                clearTimeout(timer); const n = ++sequence;
                timer = setTimeout(async () => {
                    try {
                        const r = await originalFetch('employees.php?q='+encodeURIComponent(search.value));
                        const j = await r.json(); if(n !== sequence) return;
                        employees=j.data || []; select.replaceChildren(new Option('Pilih pegawai',''));
                        for (const e of employees) select.add(new Option(e.name+(e.nip?' — '+e.nip:''),e.public_id));
                    } catch { search.placeholder='Pencarian gagal; coba lagi'; }
                },250);
            });
            select.addEventListener('change', () => {
                const employee = employees.find(e=>e.public_id===select.value);
                hidden.value=select.value; field.dataset.employeeId=select.value;
                if (employee) { field.value=employee.name; const nip=form.querySelector('[name="borrowerIdNum"]'); if(nip) nip.value=employee.nip || ''; }
            });
            form.addEventListener('reset', () => { hidden.value=''; field.dataset.employeeId=''; });
        }
    });
})();
