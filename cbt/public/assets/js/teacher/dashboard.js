(async function () {
  'use strict';
  const content = document.getElementById('content');
  const notice = document.getElementById('notice');
  let csrf = '';
  let data = { ujianList: [], hasilList: [], pelanggaranList: [] };

  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  };

  const panel = (title, description) => {
    const box = el('article', undefined, 'panel');
    box.append(el('h3', title), el('p', description));
    return box;
  };

  function table(headers, rows) {
    const table = el('table');
    const head = el('thead'),
      tr = el('tr');
    headers.forEach((h) => tr.append(el('th', h)));
    head.append(tr);
    const body = el('tbody');
    if (!rows.length) {
      const empty = el('tr'),
        cell = el('td', 'Belum ada data tersedia.');
      cell.colSpan = headers.length;
      cell.style.textAlign = 'center';
      cell.style.color = 'var(--muted)';
      empty.append(cell);
      body.append(empty);
    } else {
      rows.forEach((row) => {
        const line = el('tr');
        row.forEach((value) => {
          const td = document.createElement('td');
          if (value instanceof HTMLElement) {
            td.appendChild(value);
          } else {
            td.textContent = value ?? '-';
          }
          line.append(td);
        });
        body.append(line);
      });
    }
    table.append(head, body);
    return table;
  }

  function createBadge(text, type = 'green') {
    const b = el('span', text, 'badge');
    if (type === 'red') {
      b.style.background = '#fee2e2';
      b.style.color = '#991b1b';
      b.style.borderColor = '#fecaca';
    }
    return b;
  }

  function render(section) {
    window.CbtLiveSessions.stop();
    content.replaceChildren();
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    const titles={overview:'Dashboard',live:'Live Sessions',exams:'Ujian Diampu',results:'Hasil Siswa',violations:'Pelanggaran Ujian'};
    const pageTitle=document.getElementById('teacherPageTitle');if(pageTitle)pageTitle.textContent=titles[section]||'Dashboard';

    if (section === 'live') { window.CbtLiveSessions.mount(content, api, notice); return; }
    if (section === 'overview') {
      const metrics=el('section',undefined,'teacher-metrics');
      [["fa-calendar-days",data.ujianList.length,'Ujian Diampu','blue'],["fa-circle-check",data.hasilList.length,'Hasil Terkumpul','green'],["fa-shield-halved",data.pelanggaranList.length,'Pelanggaran Tercatat','red']].forEach(([icon,value,label,color])=>{const card=el('article',undefined,`teacher-metric ${color}`);card.innerHTML=`<div class="teacher-metric-icon"><i class="fa-solid ${icon}"></i></div><div><small>${label}</small><strong>${value}</strong><span>Lihat detail <i class="fa-solid fa-arrow-right"></i></span></div>`;metrics.append(card);});
      const overview=panel('Aktivitas Ujian Terbaru', 'Ringkasan ujian yang ditugaskan kepada Anda.');
      const list=el('div',undefined,'teacher-activity-list');
      if(data.ujianList.length){data.ujianList.slice(0,5).forEach(x=>{const row=el('div',undefined,'teacher-activity-row');row.innerHTML=`<i class="fa-solid fa-book-open"></i><div><b>${x.nama_ujian}</b><span>Tingkat ${x.tingkat||'-'} · Sesi ${x.sesi||1}</span></div><button type="button" class="teacher-link" data-target="exams">Lihat <i class="fa-solid fa-arrow-right"></i></button>`;list.append(row);});}else list.append(el('p','Belum ada ujian yang ditugaskan kepada Anda.'));
      overview.append(list);content.append(metrics,overview);return;
    }

    if (section === 'exams') {
      const box = panel('Ujian & Mapel yang Diampu', 'Daftar ujian yang secara resmi ditugaskan administrator kepada NIP Anda.');
      box.append(
        table(
          ['Nama Ujian', 'Tingkat', 'Sesi', 'Tahun Ajaran'],
          data.ujianList.map((x) => [x.nama_ujian, x.tingkat, `Sesi ${x.sesi || 1}`, x.tahun_ajaran || '-'])
        )
      );
      content.append(box);
    }

    if (section === 'results') {
      const box = panel('Hasil Siswa', 'Rekapitulasi nilai dan status pengerjaan peserta pada ujian yang Anda ampu.');
      box.classList.add('teacher-results-panel');
      const printHeader = el('header', undefined, 'teacher-print-header');
      printHeader.innerHTML = '<img src="../assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang"><div><h4>KEMENTERIAN AGAMA REPUBLIK INDONESIA</h4><h3>KANTOR KEMENTERIAN AGAMA KOTA PALEMBANG</h3><h2>MADRASAH ALIYAH NEGERI 1 PALEMBANG</h2><p>Jln. Gub. H. Bastari (Jln. Pendidikan), Jakabaring, Palembang, Sumatera Selatan</p></div>';
      const controls = el('div', undefined, 'teacher-result-controls');
      const grade = el('select'), studentClass = el('select'), print = el('button', undefined, 'teacher-print-button'), excel = el('button', undefined, 'teacher-excel-button');
      grade.setAttribute('aria-label', 'Filter tingkatan');
      studentClass.setAttribute('aria-label', 'Filter kelas');
      const grades = [...new Set(data.hasilList.map(x => String(x.tingkat || '').trim()).filter(Boolean))].sort();
      const classes = [...new Set(data.hasilList.map(x => String(x.kelas || '').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b, 'id', {numeric:true}));
      grade.append(new Option('Semua Tingkatan', 'ALL'), ...grades.map(x => new Option(`Tingkat ${x}`, x)));
      studentClass.append(new Option('Semua Kelas', 'ALL'), ...classes.map(x => new Option(x, x)));
      print.type = 'button'; print.innerHTML = '<i class="fa-solid fa-print"></i> Cetak Hasil';
      excel.type = 'button'; excel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Export Excel';
      const gradeField = el('label', undefined, 'teacher-filter-field'), classField = el('label', undefined, 'teacher-filter-field');
      gradeField.append(el('span', 'Tingkatan'), grade);
      classField.append(el('span', 'Kelas'), studentClass);
      const resultTable = el('div', undefined, 'teacher-result-table');
      let filteredResults = [];
      const updateResults = () => {
        filteredResults = data.hasilList.filter(x => (grade.value === 'ALL' || String(x.tingkat) === grade.value) && (studentClass.value === 'ALL' || String(x.kelas) === studentClass.value));
        resultTable.replaceChildren(table(
          ['NISN', 'Nama Siswa', 'Kelas', 'Tingkat', 'Ujian', 'Nilai', 'Status'],
          filteredResults.map((x) => [
            x.nomor_ujian,
            x.nama_siswa,
            x.kelas,
            x.tingkat || '-',
            x.nama_ujian,
            x.nilai !== undefined ? x.nilai : 0,
            createBadge(String(x.status || 'selesai').toUpperCase(), 'green')
          ])
        ));
      };
      grade.addEventListener('change', updateResults);
      studentClass.addEventListener('change', updateResults);
      print.addEventListener('click', () => window.print());
      excel.addEventListener('click', () => {
        if (!window.XLSX) { notice.textContent = 'Fitur Excel belum termuat. Periksa koneksi internet lalu muat ulang halaman.'; return; }
        const rows = filteredResults.map(x => ({NISN:x.nomor_ujian,'Nama Siswa':x.nama_siswa,Kelas:x.kelas,Tingkat:x.tingkat||'-',Ujian:x.nama_ujian,Nilai:x.nilai??0,Status:String(x.status||'selesai').toUpperCase()}));
        const sheet = XLSX.utils.json_to_sheet(rows, {header:['NISN','Nama Siswa','Kelas','Tingkat','Ujian','Nilai','Status']});
        sheet['!cols'] = [{wch:18},{wch:30},{wch:18},{wch:12},{wch:35},{wch:12},{wch:16}];
        const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, sheet, 'Hasil Ujian');
        XLSX.writeFile(workbook, `hasil_ujian_guru_${new Date().toISOString().slice(0,10)}.xlsx`);
      });
      controls.append(gradeField, classField, excel, print);
      box.prepend(printHeader);
      box.append(controls, resultTable);
      updateResults();
      content.append(box);
    }

    if (section === 'violations') {
      const box = panel('Log Pelanggaran', 'Catatan aktivitas kecurangan atau pergantian tab peserta selama ujian.');
      box.append(
        table(
          ['Waktu', 'NISN', 'Nama Siswa', 'Ujian', 'Jumlah', 'Keterangan'],
          data.pelanggaranList.map((x) => [
            x.waktu,
            x.nomor_ujian,
            x.nama_siswa,
            x.nama_ujian,
            createBadge(`${x.jumlah_pelanggaran}x`, 'red'),
            x.keterangan
          ])
        )
      );
      content.append(box);
    }

  }

  async function api(path, method = 'GET', body) {
    const response = await fetch('../' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Permintaan gagal.');
    return result;
  }

  try {
    const me = await fetch('../api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
    if (me.data.staff?.role !== 'TEACHER') {
      location.href = '../guru';
      return;
    }
    csrf = me.data.csrf_token;
    document.getElementById('teacherName').textContent = me.data.staff.nip || me.data.staff.username || 'Guru';
    data = (await api('api/teacher/dashboard')).data;
    render('live');
  } catch (error) {
    notice.textContent = error.message;
  }

  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => render(button.dataset.section)));
  content.addEventListener('click',e=>{const button=e.target.closest('[data-target]');if(button)render(button.dataset.target);});
  document.getElementById('menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
  const handleLogout = async () => {
    try {
      await api('api/auth/logout', 'POST', {});
    } finally {
      location.href = '../guru';
    }
  };

  const btnLogoutTop = document.getElementById('topbarLogoutGuru');
  if (btnLogoutTop) btnLogoutTop.addEventListener('click', handleLogout);
  const helpButton = document.getElementById('teacherHelpButton');
  if (helpButton) helpButton.addEventListener('click', () => alert('Hubungi proktor ruang ujian atau administrator sistem jika terdapat kendala sesi, ujian, atau data peserta.'));
})();
