import { api } from './lib/api';

type Semester = { publicId: string; type: string; academicYear: { name: string } };

const label = (semester: Semester) => `${semester.type === 'ODD' ? 'Ganjil' : 'Genap'} · ${semester.academicYear.name}`;
let installed = false;

function install(): void {
    if (location.pathname !== '/students' || installed) return;
    document.querySelector('[data-sync-students]')?.remove();
    const actions = document.querySelector('.pagehead .responsive-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.className = 'button';
    button.dataset.syncStudents = '1';
    button.textContent = 'Sync Semester';
    button.onclick = async () => {
        const semesters = (await api<Semester[]>('/semesters?perPage=100')).data;
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.innerHTML = `<div class="modal" role="dialog" aria-modal="true"><header class="modal-head"><h2>Sync Semester</h2><button type="button" data-close>×</button></header><div class="modal-body"><label class="field"><span>Semester sumber</span><select data-source><option value="">Pilih semester</option>${semesters.map(s => `<option value="${s.publicId}">${label(s)}</option>`).join('')}</select></label><label class="field"><span>Semester tujuan</span><select data-target><option value="">Pilih semester</option>${semesters.map(s => `<option value="${s.publicId}">${label(s)}</option>`).join('')}</select></label><div class="actions modal-actions"><button type="button" data-close>Batal</button><button type="button" class="primary" data-submit>Sinkronkan siswa</button></div></div></div>`;
        document.body.append(overlay);
        const close = () => overlay.remove();
        overlay.querySelectorAll('[data-close]').forEach(element => element.addEventListener('click', close));
        overlay.querySelector('[data-submit]')?.addEventListener('click', async () => {
            const source = (overlay.querySelector('[data-source]') as HTMLSelectElement).value;
            const target = (overlay.querySelector('[data-target]') as HTMLSelectElement).value;
            if (!source || !target || source === target) { window.alert('Pilih semester sumber dan tujuan yang berbeda.'); return; }
            try { const result = await api<{ copied: number }>('/students/sync-semester', { method: 'POST', body: JSON.stringify({ sourceSemesterPublicId: source, targetSemesterPublicId: target }) }); window.alert(result.message); location.reload(); } catch (error) { window.alert((error as Error).message); }
        });
    };
    actions.prepend(button);
    installed = true;
}

new MutationObserver(install).observe(document.body, { childList: true, subtree: true });
install();
