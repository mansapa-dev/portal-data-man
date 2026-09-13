const csrf = document.querySelector('meta[name="csrf-token"]').content;
const form = document.querySelector('#create-attendance');
const error = document.querySelector('#form-error');
const rosterStatus = document.querySelector('#roster-status');
const classSelect = form.elements.classPublicId;
const semesterSelect = form.elements.semesterPublicId;
const subjectSelect = form.elements.subjectPublicId;
const button = form.querySelector('button[type="submit"]');
let periods = [], rosterRequest = 0, rosterReady = false;
button.disabled = true;
const get = async url => {
    const response = await fetch(url, {credentials: 'same-origin'});
    const body = await response.json();
    if (!response.ok || body.success === false) throw new Error(body.message || 'Data gagal dimuat.');
    return body.data;
};
function options(select, placeholder, rows, label) {
    select.replaceChildren(new Option(placeholder, ''));
    for (const row of rows) select.add(new Option(label(row), row.publicId));
}
async function checkRoster() {
    const request = ++rosterRequest;
    rosterReady = false;
    button.disabled = true;
    error.hidden = true;
    if (!classSelect.value || !semesterSelect.value) {
        rosterStatus.textContent = 'Pilih kelas dan semester untuk memeriksa daftar siswa.';
        return;
    }
    rosterStatus.textContent = 'Memeriksa siswa kelas di Portal Data…';
    try {
        const data = await get(`/api/classes/${encodeURIComponent(classSelect.value)}/students?semesterPublicId=${encodeURIComponent(semesterSelect.value)}`);
        if (request !== rosterRequest) return;
        if (!Array.isArray(data.students)) throw new Error('Daftar siswa dari Portal Data tidak valid.');
        const semester = data.semester?.type === 'ODD' ? 'Ganjil' : data.semester?.type === 'EVEN' ? 'Genap' : semesterSelect.selectedOptions[0].textContent;
        if (data.students.length === 0) {
            throw new Error(`Portal Data belum mengembalikan siswa untuk kelas ${data.class?.name || classSelect.selectedOptions[0].textContent}, semester ${semester} ${data.academicYear?.name || ''}. Periksa penempatan siswa kelas tersebut pada semester yang sama di Portal Data.`);
        }
        rosterStatus.textContent = `${data.students.length} siswa tersedia untuk absensi semester ${semester}.`;
        rosterReady = true;
        button.disabled = false;
    } catch (e) {
        if (request !== rosterRequest) return;
        rosterStatus.textContent = '';
        error.textContent = e.message;
        error.hidden = false;
    }
}
classSelect.addEventListener('change', () => {
    ++rosterRequest;
    semesterSelect.replaceChildren(new Option('Pilih semester', ''));
    rosterReady = false;
    const yearId = classSelect.selectedOptions[0]?.dataset.year;
    const semesters = periods.find(item => item.publicId === yearId)?.semesters || [];
    options(semesterSelect, 'Pilih semester', semesters, item => `${item.type === 'ODD' ? 'Ganjil' : 'Genap'}${item.isActive ? ' · Aktif' : ''}`);
    const active = semesters.find(item => item.isActive === true || item.isActive === 1);
    if (active) semesterSelect.value = active.publicId;
    void checkRoster();
});
semesterSelect.addEventListener('change', () => { void checkRoster(); });
try {
    const [classes, years, subjects] = await Promise.all([
        get('/api/classes?refresh=1'), get('/api/periods?refresh=1'), get('/api/subjects')
    ]);
    periods = years;
    options(classSelect, 'Pilih kelas', classes, item => `${item.code} · ${item.name}`);
    classes.forEach((item, index) => { classSelect.options[index + 1].dataset.year = item.academicYear?.publicId || ''; });
    options(subjectSelect, 'Pilih mata pelajaran', subjects, item => item.name);
} catch (e) {
    error.textContent = e.message;
    error.hidden = false;
}
form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!rosterReady) return;
    error.hidden = true;
    button.disabled = true;
    try {
        const payload = Object.fromEntries(new FormData(form));
        payload.periodStart = Number(payload.periodStart);
        payload.periodEnd = Number(payload.periodEnd);
        const response = await fetch('/api/attendance', {method: 'POST', credentials: 'same-origin', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(payload)});
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || 'Draft gagal dibuat.');
        AgenToast.success('Sesi absensi berhasil dibuat.', {persist: true});
        location.assign(`/attendance/${body.data.session.publicId}`);
    } catch (e) {
        error.textContent = e.message;
        error.hidden = false;
        AgenToast.error(e.message);
        button.disabled = !rosterReady;
    }
});
