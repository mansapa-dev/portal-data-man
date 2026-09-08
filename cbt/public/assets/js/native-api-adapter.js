(function () {
  'use strict';
  let csrf = '';
  const refreshCsrf = async () => {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),15000);
    try {
      const response = await fetch('api/auth/me',{credentials:'same-origin',signal:controller.signal});
      const payload = await response.json();
      if(!response.ok || !payload.data?.csrf_token) throw new Error('Sesi belum dapat dikonfirmasi. Periksa koneksi.');
      csrf = payload.data.csrf_token;
    } finally { clearTimeout(timer); }
  };
  let csrfPromise = refreshCsrf();
  csrfPromise.catch(() => {});
  let answerQueue = null, releaseAttempt = null, retryTimer = null, activeExam = null, heartbeatTimer = null;
  async function closeQueue() {
    clearTimeout(retryTimer);
    clearTimeout(heartbeatTimer);
    if (answerQueue) await answerQueue.stop();
    answerQueue = null; activeExam = null;
    if (releaseAttempt) releaseAttempt();
    releaseAttempt = null;
  }
  function queueStatus(state) {
    window.dispatchEvent(new CustomEvent('cbt:answer-status', { detail: state }));
    clearTimeout(retryTimer);
    if (state.pending && !state.saving && !state.blocked) retryTimer = setTimeout(() => answerQueue?.flush().catch(() => {}), 5000 + Math.random() * 2000);
  }
  async function openQueue(examId, data) {
    await closeQueue();
    if (!navigator.locks) throw new Error('Gunakan browser terbaru melalui HTTPS agar jawaban dapat disimpan dengan aman.');
    await new Promise((resolve, reject) => {
      navigator.locks.request('cbt-attempt-' + data.attempt_id, { ifAvailable: true }, lock => {
        if (!lock) { reject(new Error('Ujian ini terbuka di tab lain. Tutup tab tersebut lalu lanjutkan.')); return; }
        return new Promise(release => { releaseAttempt = release; resolve(); });
      }).catch(reject);
    });
    try {
      answerQueue = new CbtAnswerQueue({ storage: localStorage, key: 'cbt:answers:' + data.attempt_id, attemptId: data.attempt_id,
        send: async item => (await api(`api/student/exams/${examId}/answers/${item.question_id}`, 'PUT', item)).data,
        notify: queueStatus });
      activeExam = String(examId);
      const pulse = async () => {
        if (activeExam !== String(examId)) return;
        try { await api(`api/student/exams/${examId}/heartbeat`,'POST',{}); } catch (_) { /* Answers report connection failures separately. */ }
        if (activeExam === String(examId)) heartbeatTimer = setTimeout(pulse,30000 + Math.random()*3000);
      };
      pulse();
      const restored = answerQueue.restore(data.jawaban);
      answerQueue.flush().catch(() => {});
      return restored;
    } catch (error) { await closeQueue(); throw error; }
  }
  window.addEventListener('online', () => answerQueue?.flush().catch(() => {}));
  window.addEventListener('beforeunload', event => {
    if (answerQueue?.state().pending) { event.preventDefault(); event.returnValue = ''; }
  });
  window.cbtAnswerState = () => answerQueue?.state() || { pending: 0 };
  async function api(path, method = 'GET', body) {
    try { await csrfPromise; } catch (_) { csrfPromise = refreshCsrf(); await csrfPromise; }
    const controller = new AbortController();
    // Login/start can queue during a mass arrival; accepted answers keep a short retry window.
    const timeoutMs = /auth\/student\/login|student\/exams\/\d+\/start/.test(path) ? 120000 : /student\/exams\/\d+\/submit/.test(path) ? 60000 : 15000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response, payload;
    try {
    response = await fetch(path.replace(/^\//, ''), { method, signal: controller.signal, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
    payload = await response.json();
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      if (response.status === 419) csrfPromise = refreshCsrf();
      const error = new Error(payload.message || 'Permintaan gagal.'); error.status = response.status; throw error;
    }
    if (method !== 'GET') window.dispatchEvent(new CustomEvent('cbt:data-updated', { detail: { path, method } }));
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
    async createSupportTicket(data) { const r=await api('api/student/support-tickets/request','POST',data);return {success:true,ticket:r.data,message:r.message}; },
    async getStudentSupportTickets() { const r=await api('api/student/support-tickets');return {success:true,tickets:r.data}; },
    async getStaffSupportTickets(status='ALL') { const r=await api(`api/staff/support-tickets?status=${encodeURIComponent(status)}`);return {success:true,tickets:r.data}; },
    async updateSupportTicket(id,status,note='') { const r=await api(`api/staff/support-tickets/${id}/status`,'POST',{status,note});return {success:true,ticket:r.data,message:r.message}; },
    async resetSupportTicket(id,reason) { const r=await api(`api/admin/support-tickets/${id}/reset`,'POST',{reason});return {success:true,...r.data,message:r.message}; },
    async loginPenggunaAPI(username, password) { const r = await api('api/auth/staff/login', 'POST', { username, password }); return { success: true, userId:r.data.id, id:r.data.id, nama:r.data.nama, role:r.data.role, username:r.data.username }; },
    async getServerSoal(examId) { const r = await api(`api/student/exams/${examId}/start`, 'POST', {}); if(r.data.completed) { await closeQueue(); return {success:true,...r.data}; } const restored = await openQueue(examId, r.data); return { success: true, soal: r.data.soal.map(q => ({ id:q.id, pertanyaan:q.pertanyaan, opsi:q.opsi })), jawaban: restored.map(a => ({ soal_id:a.question_id, jawaban:a.answer, ragu:!!Number(a.is_flagged) })), expiresAt:r.data.expires_at, serverTime:r.data.server_time, serverOrdered:true }; },
    async simpanJawabanServer(data) { if (!answerQueue || activeExam !== String(data.ujianId)) throw new Error('Sesi penyimpanan tidak tersedia. Muat ulang ujian.'); answerQueue.enqueue(data.soalId, data.jawaban, data.ragu); return { success:true, queued:true }; },
    async catatPelanggaranServer(studentId, examId) { const r=await api(`api/student/exams/${examId}/violations`,'POST',{event_key:`visibility:${Date.now()}:${Math.random().toString(36).slice(2)}`,type:'TAB_HIDDEN',client_occurred_at:new Date().toISOString().slice(0,23).replace('T',' ')}); if(r.data.terminated) await closeQueue(); return {success:true,jumlah:r.data.jumlah,dihentikan:r.data.terminated,hasil:r.data.hasil}; },
    async submitUjian(data) {
      if (answerQueue && activeExam === String(data.ujian_id)) {
        if (data.finalize_only) await answerQueue.stop();
        else { await answerQueue.flush(); if(answerQueue.state().pending) throw new Error('Masih ada jawaban yang belum terkirim. Coba kumpulkan kembali.'); }
      }
      const r=await api(`api/student/exams/${data.ujian_id}/submit`,'POST',{finalize_only:!!data.finalize_only});
      // Keep unaccepted answers for recovery; never claim that they were scored.
      const pending = answerQueue?.state().pending || 0;
      if (answerQueue && !pending) answerQueue.complete();
      await closeQueue();
      return {success:true,hasil:r.data,unsent:pending};
    },
    async getReviewUjianServer(studentId,examId) { const r=await api(`api/student/exams/${examId}/review`);return {success:true,...r.data}; },
    async getAdminDashboardStats() { const r=await api('api/admin/dashboard');return {success:true,...r.data}; },
    async getPortalDataReferences() { const r=await api('api/admin/portal-data/references');return {success:true,...r.data}; },
    async syncPortalData(type) { const r=await api(`api/admin/portal-data/sync/${type}`,'POST',{});return {success:true,...r.data}; },
    async getAdminUjianList() { const r=await api('api/admin/exams');return r.data; },
    async hentikanSesiSiswaAdmin(session,attemptId) { const r=await api(`api/admin/live-sessions/${attemptId}/terminate`,'POST',{});return {success:true,...r.data,message:r.message}; },
    async akhiriSesiUjianAdmin(session,examId) { const r=await api(`api/admin/exams/${examId}/terminate`,'POST',{});return {success:true,...r.data,message:r.message}; },
    async simpanUjianAdmin(session,data) { await api('api/admin/exams','POST',data);return {success:true,message:'Ujian berhasil disimpan.'}; },
    async simpanUjianLanjutanAdmin(session,data) { const r=await api('api/admin/follow-up-exams','POST',data);return {success:true,...r.data,message:r.message}; },
    async getKandidatUjianLanjutan() { const r=await api('api/admin/follow-up-exams/candidates');return r.data; },
    async setujuiKandidatUjianUlang(session,examId,studentIds) { const r=await api('api/admin/follow-up-exams/retake-candidates/approve','POST',{exam_id:examId,student_ids:studentIds});return {success:true,...r.data,message:r.message}; },
    async getKandidatUjianSusulan() { const r=await api('api/admin/follow-up-exams/make-up-candidates');return r.data; },
    async getJadwalUjianLanjutan() { const r=await api('api/admin/follow-up-exams');return r.data; },
    async setStatusUjianLanjutan(session,id,active) { await api(`api/admin/follow-up-exams/${id}/status`,'POST',{active});return {success:true}; },
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
    async generatePinsBatchAdmin(session,data) { const r=await api('api/admin/students/generate-pins','POST',data);return {success:true,...r.data,message:r.message}; },
    async adminBukaBlokirSiswa(session,id,examId,reason) { await api(`api/admin/students/${id}/reset`,'POST',{exam_id:examId,reason});return {success:true,message:'Siswa berhasil dibuka/reset.'}; },
    async hapusSiswaAdmin() { return {success:false,message:'Identitas siswa dikelola Portal Data dan tidak dapat dihapus dari CBT.'}; },
    async hapusSiswaPertingkatAdmin() { return {success:false,message:'Data siswa dikelola Portal Data. Nonaktifkan di Portal lalu jalankan sinkronisasi.'}; },
    async prosesKenaikanKelasAdmin() { await api('api/admin/portal-data/sync/students','POST',{});return {success:true,dataXII:[],message:'Kelas diperbarui melalui sinkronisasi Portal Data.'}; },
    async importSiswaBulk() { return {success:false,message:'Excel bukan source of truth. Gunakan Sinkronisasi Portal Data.'}; },
    async updatePasswordGuru(session,oldPass,newPass) { await api('api/auth/password','POST',{old_password:oldPass,new_password:newPass});return {success:true,message:'Password berhasil diperbarui.'}; },
    async importSoalBulk(session,rows) {
      const batches=[];let batch=[],bytes=0;
      for(const row of rows){
        const rowBytes=new TextEncoder().encode(JSON.stringify(row)).length;
        if(rowBytes>3500000)throw new Error('Salah satu gambar terlalu besar untuk dikirim. Maksimal ukuran file gambar adalah 2 MB.');
        if(batch.length&&bytes+rowBytes>3500000){batches.push(batch);batch=[];bytes=0;}
        batch.push(row);bytes+=rowBytes;
      }
      if(batch.length)batches.push(batch);
      const summary={total:0,inserted:0,failed:0,errors:[]};let offset=0;
      for(const rowsBatch of batches){
        const r=await api('api/admin/questions/import','POST',{rows:rowsBatch});
        summary.total+=Number(r.data.total||0);summary.inserted+=Number(r.data.inserted||0);summary.failed+=Number(r.data.failed||0);
        for(const error of r.data.errors||[])summary.errors.push({...error,row:Number(error.row||2)+offset});
        offset+=rowsBatch.length;
      }
      return {success:true,message:`Import selesai: ${summary.inserted} berhasil, ${summary.failed} gagal.`,summary};
    },
    async importAkunBulk(session,rows) { const r=await api('api/admin/users/import','POST',{rows});return {success:true,message:r.message,summary:r.data}; },
    async getAdminSettings() { const r=await api('api/admin/settings');return {success:true,data:r.data}; },
    async saveAdminSettings(session,data) { const r=await api('api/admin/settings','POST',data);return {success:true,data:r.data,message:r.message}; }
  };
  window.cbtServerLogout = async function () { await closeQueue(); try { await api('api/auth/logout','POST',{}); } finally { csrfPromise=refreshCsrf(); } };
  window.cbtApi = { run: new Proxy({}, { get(_, name) { const state={success:null,failure:null}; if(name==='withSuccessHandler')return fn=>(state.success=fn,chain(state)); if(name==='withFailureHandler')return fn=>(state.failure=fn,chain(state)); return (...args)=>invoke(name,args,state); function chain(s){return new Proxy({}, {get(_x,n){if(n==='withSuccessHandler')return fn=>(s.success=fn,chain(s));if(n==='withFailureHandler')return fn=>(s.failure=fn,chain(s));return(...a)=>invoke(n,a,s);}});} } }) };
  window.cbtApi = window.cbtApi.run;
  function mapExams(exams){return exams.map(e=>({id:e.id,nama_ujian:e.nama_ujian,tingkat:e.tingkat,durasi_menit:e.durasi,tanggal_ujian:e.tanggal_mulai,jam_mulai:e.jam_mulai,jam_selesai:e.jam_selesai,sesi:e.sesi||1,tahun_ajaran:e.tahun_ajaran,semester:e.semester,is_special:!!e.is_special,special_type:e.special_type||null,can_start:!!e.can_start,availability_reason:e.availability_reason||'NOT_ELIGIBLE',status_pengerjaan:({IN_PROGRESS:'berlangsung',COMPLETED:'selesai',TERMINATED:'terblokir',EXPIRED:'selesai'})[e.status_attempt]||'belum'}));}
  function invoke(name,args,state){const fn=calls[name];if(!fn){const err=new Error(`Fitur ${String(name)} belum dimigrasikan.`);state.failure?.(err);return;}Promise.resolve(fn(...args)).then(v=>state.success?.(v)).catch(e=>state.failure?.(e));}
})();
