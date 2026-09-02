// Teacher monitoring dashboard for assigned exams and violations.
function loadDataGuru() {
  const cont = document.getElementById('containerListUjianGuru');
  cont.innerHTML = `<div class="alert info">Mengambil data ujian & mapel yang diampu dari server...</div>`;
  cbtApi
    .withSuccessHandler(res => {
      if(!res || !res.success || !res.ujianList || res.ujianList.length===0){
        cont.innerHTML = `<div class="alert error" style="display:block;">Tidak ada ujian/mapel yang ditugaskan kepada Anda saat ini.</div>`; return;
      }
      
      const pelanggaranMap = {};
      (res.pelanggaranList || []).forEach(p => {
        if(!pelanggaranMap[p.ujian_id]) pelanggaranMap[p.ujian_id] = [];
        pelanggaranMap[p.ujian_id].push(p);
      });

      cont.innerHTML = res.ujianList.map(u => {
        const hasil = (res.hasilList||[]).filter(h => String(h.ujian_id) === String(u.id));
        const pelanggaranUjian = pelanggaranMap[u.id] || [];

        let tbHtml = hasil.length===0 ? `<tr><td colspan="5" align="center" style="color:var(--text-muted);">Belum ada peserta submit.</td></tr>` :
          hasil.map(h => `<tr><td>${h.nomor_ujian || '-'}</td><td><b>${h.nama_siswa || '-'}</b></td><td>${h.kelas || '-'}</td><td><b style="color:var(--primary); font-size:14px;">${h.nilai !== undefined ? h.nilai : 0}</b></td><td><span class="badge bg-green">${String(h.status || 'selesai').toUpperCase()}</span></td></tr>`).join('');
        
        let pelanggaranHtml = pelanggaranUjian.length === 0 ? `<p style="font-size:12px; color:var(--text-muted); padding:12px;">Tidak ada pelanggaran tercatat.</p>` : `
          <div class="table-responsive" style="margin-top:12px;">
            <table style="font-size:12px;">
              <thead><tr><th>No Peserta</th><th>Nama Siswa</th><th>Jumlah</th><th>Keterangan</th></tr></thead>
              <tbody>
                ${pelanggaranUjian.map(p => `<tr><td><b>${p.nomor_ujian || '-'}</b></td><td><b>${p.nama_siswa || '-'}</b></td><td><span class="badge bg-red">${p.jumlah_pelanggaran}x</span></td><td>${p.keterangan || '-'}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>`;

        let reportData = hasil.map(h => [h.nomor_ujian, h.nama_siswa, h.kelas, h.nilai, h.status]);
        
        return `
          <div class="card" style="border:1px solid var(--primary); padding:0; overflow:hidden; margin-bottom:20px;">
            <div style="background:#eff6ff; padding:16px 20px; border-bottom:1px solid #bfdbfe; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
              <div>
                <h3 style="font-size:16px; font-weight:800; color:var(--primary); margin-bottom:4px;"><i class="fa-solid fa-book-open"></i> ${u.nama_ujian}</h3>
                <p style="font-size:12px; color:var(--text-muted);">Tingkat: ${u.tingkat} | Sesi & Tanggal: ${u.nama_ujian} | Thn Ajaran: ${u.tahun_ajaran||'-'} (${u.semester||'-'}) | Submit: <b>${hasil.length} Siswa</b></p>
              </div>
              <div style="display:flex; gap:8px;">
                <button class="btn btn-secondary" style="padding:6px 12px; font-size:12px;" onclick='exportToExcel("laporan_${u.nama_ujian.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.xlsx", "Nilai", ["No Ujian", "Nama", "Kelas", "Nilai", "Status"], ${JSON.stringify(reportData)})'><i class="fa-solid fa-file-excel"></i> Download Excel</button>
              </div>
            </div>
            <div style="padding:16px;">
              <h4 style="font-size:13px; font-weight:700; margin-bottom:8px;">Daftar Nilai Siswa</h4>
              <div class="table-responsive">
                <table><thead><tr><th>No Peserta</th><th>Nama Siswa</th><th>Kelas</th><th>Nilai Akhir</th><th>Status</th></tr></thead><tbody>${tbHtml}</tbody></table>
              </div>
              <h4 style="font-size:13px; font-weight:700; margin:16px 0 8px 0;">Log Pelanggaran Siswa</h4>
              ${pelanggaranHtml}
            </div>
          </div>`;
      }).join('');
    })
    .withFailureHandler(err => {
      cont.innerHTML = `<div class="alert error" style="display:block;">Gagal memuat monitoring: ${err.message}</div>`;
    })
    .getGuruExamResults(stPengelola);
}
