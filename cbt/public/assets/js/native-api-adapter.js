(function () {
  'use strict';
  let csrf = '';
  const refreshCsrf = () => fetch('api/auth/me', { credentials: 'same-origin' }).then(r => r.json()).then(r => { csrf = r.data.csrf_token; });
  let csrfPromise = refreshCsrf();
  async function api(path, method = 'GET', body) {
    await csrfPromise;
    const response = await fetch(path.replace(/^\//, ''), { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = await response.json().catch(() => ({ success: false, message: 'Respons server tidak valid.' }));
    if (!response.ok) throw new Error(payload.message || 'Permintaan gagal.');
    return payload;
  }
  const calls = {
    async loginSiswaAPI(nisn, pin) {
      const login = await api('api/auth/student/login', 'POST', { nisn, pin });
      const exams = await api('api/student/exams');
      const s = login.data;
      return { success: true, siswa: { id: s.nisn, nomor_ujian: s.nisn, nisn: s.nisn, nama: s.nama, kelas: s.kelas, tingkat: s.tingkat }, jadwal: mapExams(exams.data) };
    },
    async getStudentExamsAPI() { const exams=await api('api/student/exams');return {success:true,jadwal:mapExams(exams.data)}; },
    async loginPenggunaAPI(username, password) { const r = await api('api/auth/staff/login', 'POST', { username, password }); return { success: true, userId:r.data.id, id:r.data.id, nama:r.data.nama, role:r.data.role, username:r.data.username }; },
    async getServerSoal(examId) { const r = await api(`api/student/exams/${examId}/start`, 'POST', {}); return { success: true, soal: r.data.soal.map(q => ({ id:q.id, pertanyaan:q.pertanyaan, opsi:q.opsi })), jawaban: r.data.jawaban.map(a => ({ soal_id:a.question_id, jawaban:a.answer, ragu:!!Number(a.is_flagged) })), expiresAt:r.data.expires_at, serverTime:r.data.server_time, serverOrdered:true }; },
    async simpanJawabanServer(data) { await api(`api/student/exams/${data.ujianId}/answers/${data.soalId}`, 'PUT', { answer:data.jawaban, is_flagged:!!data.ragu }); return { success:true }; },
    async catatPelanggaranServer(studentId, examId) { const r=await api(`api/student/exams/${examId}/violations`,'POST',{event_key:`visibility:${Date.now()}:${Math.random().toString(36).slice(2)}`,type:'TAB_HIDDEN',client_occurred_at:new Date().toISOString().slice(0,23).replace('T',' ')});return {success:true,jumlah:r.data.jumlah,dihentikan:r.data.terminated}; },
    async submitUjian(data) { const r=await api(`api/student/exams/${data.ujian_id}/submit`,'POST',{});return {success:true,hasil:r.data}; },
    async getReviewUjianServer(studentId,examId) { const r=await api(`api/student/exams/${examId}/review`);return {success:true,...r.data}; },
    async getAdminDashboardStats() { const r=await api('api/admin/dashboard');return {success:true,...r.data}; },
    async getPortalDataReferences() { const r=await api('api/admin/portal-data/references');return {success:true,...r.data}; },
    async syncPortalData(type) { const r=await api(`api/admin/portal-data/sync/${type}`,'POST',{});return {success:true,...r.data}; },
    async getAdminUjianList() { const r=await api('api/admin/exams');return r.data; },
    async simpanUjianAdmin(session,data) { await api('api/admin/exams','POST',data);return {success:true,message:'Ujian berhasil disimpan.'}; },
    async simpanUjianLanjutanAdmin(session,data) { const r=await api('api/admin/follow-up-exams','POST',data);return {success:true,...r.data,message:r.message}; },
    async getAdminSoalList(session,examId) { const r=await api(`api/admin/questions${examId?`?exam_id=${encodeURIComponent(examId)}`:''}`);return r.data; },
    async simpanSoalAdmin(session,data) { await api('api/admin/questions','POST',data);return {success:true,message:'Soal berhasil disimpan.'}; },
    async getAdminAkunList() { const r=await api('api/admin/users');return r.data; },
    async simpanAkunAdmin(session,data) { await api('api/admin/users','POST',data);return {success:true,message:'Akun berhasil disimpan.'}; },
    async getAdminGuruUjianList() { const r=await api('api/admin/teacher-assignments');return {success:true,...r.data}; },
    async simpanGuruUjianAdmin(session,data) { await api('api/admin/teacher-assignments','POST',data);return {success:true,message:'Penugasan berhasil disimpan.'}; },
    async hapusGuruUjianAdmin(session,id) { await api(`api/admin/teacher-assignments/${id}`,'DELETE');return {success:true,message:'Penugasan berhasil dihapus.'}; },
    async getAdminHasilGlobal() { const r=await api('api/admin/results');return {success:true,data:r.data}; },
    async getAdminLogPelanggaran() { const r=await api('api/admin/violations');return {success:true,data:r.data}; },
    async getGuruExamResults() { const r=await api('api/teacher/dashboard');return {success:true,...r.data}; },
    async getAdminSiswaList() { const r=await api('api/admin/students');return r.data; },
    async simpanSiswaSatuanAdmin(session,data) { const r=await api('api/admin/students/pin','POST',data);return {success:true,pin:r.data?.pin,message:r.message||'PIN CBT siswa berhasil disimpan.'}; },
    async generatePinsBatchAdmin(session,data) { const r=await api('api/admin/students/generate-pins','POST',data);return {success:true,updated:r.data?.updated,message:r.message}; },
    async adminBukaBlokirSiswa(session,id) { await api(`api/admin/students/${id}/reset`,'POST',{});return {success:true,message:'Siswa berhasil dibuka/reset.'}; },
    async hapusSiswaAdmin() { return {success:false,message:'Identitas siswa dikelola Portal Data dan tidak dapat dihapus dari CBT.'}; },
    async hapusSiswaPertingkatAdmin() { return {success:false,message:'Data siswa dikelola Portal Data. Nonaktifkan di Portal lalu jalankan sinkronisasi.'}; },
    async prosesKenaikanKelasAdmin() { await api('api/admin/portal-data/sync/students','POST',{});return {success:true,dataXII:[],message:'Kelas diperbarui melalui sinkronisasi Portal Data.'}; },
    async importSiswaBulk() { return {success:false,message:'Excel bukan source of truth. Gunakan Sinkronisasi Portal Data.'}; },
    async updatePasswordGuru(session,oldPass,newPass) { await api('api/auth/password','POST',{old_password:oldPass,new_password:newPass});return {success:true,message:'Password berhasil diperbarui.'}; },
    async importSoalBulk(session,rows) { const r=await api('api/admin/questions/import','POST',{rows});return {success:true,message:r.message,summary:r.data}; },
    async importAkunBulk(session,rows) { const r=await api('api/admin/users/import','POST',{rows});return {success:true,message:r.message,summary:r.data}; }
  };
  window.cbtServerLogout = async function () { try { await api('api/auth/logout','POST',{}); } finally { csrfPromise=refreshCsrf(); } };
  window.cbtApi = { run: new Proxy({}, { get(_, name) { const state={success:null,failure:null}; if(name==='withSuccessHandler')return fn=>(state.success=fn,chain(state)); if(name==='withFailureHandler')return fn=>(state.failure=fn,chain(state)); return (...args)=>invoke(name,args,state); function chain(s){return new Proxy({}, {get(_x,n){if(n==='withSuccessHandler')return fn=>(s.success=fn,chain(s));if(n==='withFailureHandler')return fn=>(s.failure=fn,chain(s));return(...a)=>invoke(n,a,s);}});} } }) };
  window.cbtApi = window.cbtApi.run;
  function mapExams(exams){return exams.map(e=>({id:e.id,nama_ujian:e.nama_ujian,tingkat:e.tingkat,durasi_menit:e.durasi,tanggal_ujian:e.tanggal_mulai,jam_mulai:e.jam_mulai,jam_selesai:e.jam_selesai,sesi:e.sesi||1,tahun_ajaran:e.tahun_ajaran,semester:e.semester,status_pengerjaan:({IN_PROGRESS:'berlangsung',COMPLETED:'selesai',TERMINATED:'terblokir',EXPIRED:'selesai'})[e.status_attempt]||'belum'}));}
  function invoke(name,args,state){const fn=calls[name];if(!fn){const err=new Error(`Fitur ${String(name)} belum dimigrasikan.`);state.failure?.(err);return;}Promise.resolve(fn(...args)).then(v=>state.success?.(v)).catch(e=>state.failure?.(e));}
})();
