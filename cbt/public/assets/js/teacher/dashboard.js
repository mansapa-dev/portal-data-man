(async function () {
  'use strict';
  const content = document.getElementById('content');
  const notice = document.getElementById('notice');
  let csrf = '';
  let data = { ujianList: [], hasilList: [], pelanggaranList: [] };
  let activeSection = 'overview';

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
    } else if (type === 'gray') {
      b.style.background = '#f1f5f9';
      b.style.color = '#475569';
      b.style.borderColor = '#cbd5e1';
    } else if (type === 'orange') {
      b.style.background = '#fff7ed';
      b.style.color = '#c2410c';
      b.style.borderColor = '#fed7aa';
    }
    return b;
  }

  /**
   * Map status ujian ke badge yang sesuai (selaras dengan tampilan admin).
   */
  function statusBadge(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'completed') return createBadge('SELESAI', 'green');
    if (s === 'terminated') return createBadge('DIHENTIKAN', 'red');
    if (s === 'in_progress') return createBadge('BERLANGSUNG', 'orange');
    return createBadge(s.toUpperCase(), 'gray');
  }

  /**
   * Format string datetime UTC ke waktu lokal WIB.
   * Handles ISO string, atau string "YYYY-MM-DD HH:MM:SS" dari DB.
   */
  function fmtDatetime(raw) {
    if (!raw) return '-';
    const isoStr = String(raw).replace(' ', 'T').replace(/Z?$/, 'Z');
    try {
      return new Date(isoStr).toLocaleString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return raw;
    }
  }

  /**
   * Humanize tipe pelanggaran dari format raw DB ke teks yang mudah dibaca.
   */
  const VIOLATION_LABELS = {
    TAB_SWITCH: 'Pindah Tab',
    COPY_ATTEMPT: 'Menyalin Teks',
    PASTE_ATTEMPT: 'Menempel Teks',
    PRINT_ATTEMPT: 'Mencoba Cetak',
    FULLSCREEN_EXIT: 'Keluar Layar Penuh',
    CONTEXT_MENU: 'Klik Kanan',
    BLUR: 'Keluar Jendela',
    FOCUS_LOST: 'Fokus Hilang',
    DEV_TOOLS: 'Buka DevTools',
  };
  function humanizeViolation(type) {
    if (!type) return '-';
    return VIOLATION_LABELS[String(type).toUpperCase()] || String(type).replace(/_/g, ' ');
  }

  function render(section) {
    activeSection = section;
    content.replaceChildren();
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.section === section));
    const titles = { overview: 'Dashboard', exams: 'Ujian Diampu', results: 'Hasil Siswa', violations: 'Pelanggaran Ujian' };
    const pageTitle = document.getElementById('teacherPageTitle');
    if (pageTitle) pageTitle.textContent = titles[section] || 'Dashboard';

    if (section === 'overview') {
      const metrics = el('section', undefined, 'teacher-metrics');
      [
        ['fa-calendar-days', data.ujianList.length, 'Ujian Diampu', 'blue', 'exams'],
        ['fa-circle-check', data.hasilList.length, 'Hasil Terkumpul', 'green', 'results'],
        ['fa-shield-halved', data.pelanggaranList.length, 'Pelanggaran Tercatat', 'red', 'violations'],
      ].forEach(([icon, value, label, color, target]) => {
        const card = el('button', undefined, `teacher-metric ${color}`);
        card.type = 'button';
        card.dataset.target = target;
        card.setAttribute('aria-label', `${label}: ${value}. Lihat detail`);
        card.innerHTML = `<div class="teacher-metric-icon"><i class="fa-solid ${icon}"></i></div><div><small>${label}</small><strong>${value}</strong><span>Lihat detail <i class="fa-solid fa-arrow-right"></i></span></div>`;
        metrics.append(card);
      });
      const overview = panel('Aktivitas Ujian Terbaru', 'Ringkasan ujian yang ditugaskan kepada Anda.');
      const list = el('div', undefined, 'teacher-activity-list');
      if (data.ujianList.length) {
        data.ujianList.slice(0, 5).forEach((x) => {
          const row = el('div', undefined, 'teacher-activity-row');
          row.innerHTML = `<i class="fa-solid fa-book-open"></i><div><b>${x.nama_ujian}</b><span>Tingkat ${x.tingkat || '-'} · Sesi ${x.sesi || 1}</span></div><button type="button" class="teacher-link" data-target="exams">Lihat <i class="fa-solid fa-arrow-right"></i></button>`;
          list.append(row);
        });
      } else {
        list.append(el('p', 'Belum ada ujian yang ditugaskan kepada Anda.'));
      }
      overview.append(list);
      content.append(metrics, overview);
      return;
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

    /* ================================================================
       HASIL SISWA
    ================================================================ */
    if (section === 'results') {
      const box = panel('Hasil Siswa', 'Rekapitulasi nilai dan status pengerjaan peserta pada ujian yang Anda ampu.');
      box.classList.add('teacher-results-panel');

      // Kop surat cetak
      const printHeader = el('header', undefined, 'teacher-print-header');
      printHeader.innerHTML = '<img src="../assets/img/logo-man1-palembang.png" alt="Lambang MAN 1 Palembang"><div><h4>KEMENTERIAN AGAMA REPUBLIK INDONESIA</h4><h3>KANTOR KEMENTERIAN AGAMA KOTA PALEMBANG</h3><h2>MADRASAH ALIYAH NEGERI 1 PALEMBANG</h2><p>Jln. Gub. H. Bastari (Jln. Pendidikan), Jakabaring, Palembang, Sumatera Selatan</p></div>';

      // ---- Filter bar ----
      const controls = el('div', undefined, 'teacher-result-controls');

      // Kumpulkan nilai unik dari data
      const examClasses = data.ujianList.flatMap((x) =>
        String(x.nama_kelas_target || '').split(',').map((v) => v.trim()).filter(Boolean)
      );
      const grades = [...new Set([
        ...data.ujianList.map((x) => String(x.tingkat || '').trim()),
        ...data.hasilList.map((x) => String(x.tingkat || '').trim()),
      ].filter(Boolean))].sort();
      const classes = [...new Set([
        ...examClasses,
        ...data.hasilList.map((x) => String(x.kelas || '').trim()),
      ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
      const subjects = [...new Set([
        ...data.ujianList.map((x) => String(x.nama_mapel || '').trim()),
        ...data.hasilList.map((x) => String(x.nama_mapel || '').trim()),
      ].filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
      const years = [...new Set(data.hasilList.map((x) => String(x.tahun_ajaran || '').trim()).filter(Boolean))].sort().reverse();
      const semesters = [...new Set(data.hasilList.map((x) => String(x.semester || '').trim()).filter(Boolean))].sort();

      // Buat select element
      const grade = el('select');
      const studentClass = el('select');
      const subject = el('select');
      const yearSel = el('select');
      const semesterSel = el('select');
      const print = el('button', undefined, 'teacher-print-button');
      const excel = el('button', undefined, 'teacher-excel-button');

      grade.setAttribute('aria-label', 'Filter tingkatan');
      studentClass.setAttribute('aria-label', 'Filter kelas');
      subject.setAttribute('aria-label', 'Filter mata pelajaran');
      yearSel.setAttribute('aria-label', 'Filter tahun ajaran');
      semesterSel.setAttribute('aria-label', 'Filter semester');

      grade.append(new Option('Semua Tingkatan', 'ALL'), ...grades.map((x) => new Option(`Tingkat ${x}`, x)));
      studentClass.append(new Option('Semua Kelas', 'ALL'), ...classes.map((x) => new Option(x, x)));
      subject.append(new Option('Semua Mata Pelajaran', 'ALL'), ...subjects.map((x) => new Option(x, x)));
      yearSel.append(new Option('Semua Tahun Ajaran', 'ALL'), ...years.map((x) => new Option(x, x)));
      semesterSel.append(
        new Option('Semua Semester', 'ALL'),
        new Option('Ganjil', 'Ganjil'),
        new Option('Genap', 'Genap'),
      );

      print.type = 'button';
      print.innerHTML = '<i class="fa-solid fa-print"></i> Cetak Hasil';
      excel.type = 'button';
      excel.innerHTML = '<i class="fa-solid fa-file-excel"></i> Export Excel';

      // Label wrapper
      const mkField = (label, selectEl) => {
        const f = el('label', undefined, 'teacher-filter-field');
        f.append(el('span', label), selectEl);
        return f;
      };

      const resultTable = el('div', undefined, 'teacher-result-table');
      let filteredResults = [];

      const updateResults = () => {
        filteredResults = data.hasilList.filter((x) =>
          (grade.value === 'ALL' || String(x.tingkat) === grade.value) &&
          (studentClass.value === 'ALL' || String(x.kelas) === studentClass.value) &&
          (subject.value === 'ALL' || String(x.nama_mapel) === subject.value) &&
          (yearSel.value === 'ALL' || String(x.tahun_ajaran) === yearSel.value) &&
          (semesterSel.value === 'ALL' || String(x.semester) === semesterSel.value)
        );

        resultTable.replaceChildren(table(
          ['No. Peserta', 'Nama Siswa', 'Kelas', 'Tingkat', 'Mata Pelajaran', 'Nama Ujian', 'Nilai', 'Benar', 'Salah', 'Status', 'Waktu Selesai'],
          filteredResults.map((x) => [
            x.nomor_ujian || '-',
            x.nama_siswa,
            x.kelas || '-',
            x.tingkat || '-',
            x.nama_mapel || 'Mata Pelajaran Umum',
            x.nama_ujian,
            x.nilai !== undefined && x.nilai !== null ? Number(x.nilai).toFixed(1) : '0.0',
            x.jumlah_benar !== undefined ? x.jumlah_benar : '-',
            x.jumlah_salah !== undefined ? x.jumlah_salah : '-',
            statusBadge(x.status),
            fmtDatetime(x.waktu_selesai),
          ])
        ));
      };

      [grade, studentClass, subject, yearSel, semesterSel].forEach((s) => s.addEventListener('change', updateResults));

      print.addEventListener('click', () => window.print());
      excel.addEventListener('click', () => {
        if (!window.XLSX) {
          notice.textContent = 'Fitur Excel belum termuat. Periksa koneksi internet lalu muat ulang halaman.';
          return;
        }
        const rows = filteredResults.map((x) => ({
          'No. Peserta': x.nomor_ujian,
          'Nama Siswa': x.nama_siswa,
          'Kelas': x.kelas,
          'Tingkat': x.tingkat || '-',
          'Mata Pelajaran': x.nama_mapel || 'Mata Pelajaran Umum',
          'Ujian': x.nama_ujian,
          'Nilai': x.nilai !== null ? Number(x.nilai).toFixed(1) : '0.0',
          'Benar': x.jumlah_benar ?? '-',
          'Salah': x.jumlah_salah ?? '-',
          'Status': String(x.status || '').toUpperCase(),
          'Waktu Selesai': fmtDatetime(x.waktu_selesai),
          'Tahun Ajaran': x.tahun_ajaran || '-',
          'Semester': x.semester || '-',
        }));
        const headers = ['No. Peserta', 'Nama Siswa', 'Kelas', 'Tingkat', 'Mata Pelajaran', 'Ujian', 'Nilai', 'Benar', 'Salah', 'Status', 'Waktu Selesai', 'Tahun Ajaran', 'Semester'];
        const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
        sheet['!cols'] = [
          { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 10 }, { wch: 28 },
          { wch: 35 }, { wch: 10 }, { wch: 8 }, { wch: 8 }, { wch: 14 },
          { wch: 22 }, { wch: 18 }, { wch: 10 },
        ];
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, sheet, 'Hasil Ujian');
        XLSX.writeFile(workbook, `hasil_ujian_guru_${new Date().toISOString().slice(0, 10)}.xlsx`);
      });

      controls.append(
        mkField('Tahun Ajaran', yearSel),
        mkField('Semester', semesterSel),
        mkField('Tingkatan', grade),
        mkField('Kelas', studentClass),
        mkField('Mata Pelajaran', subject),
        excel,
        print,
      );

      box.prepend(printHeader);
      box.append(controls, resultTable);
      updateResults();
      content.append(box);
    }

    /* ================================================================
       LOG PELANGGARAN
    ================================================================ */
    if (section === 'violations') {
      const box = panel('Log Pelanggaran', 'Catatan aktivitas kecurangan atau pergantian tab peserta selama ujian yang Anda ampu.');

      // ---- Filter bar ----
      const filterBar = el('div', undefined, 'teacher-result-controls');

      const searchInput = el('input');
      searchInput.type = 'search';
      searchInput.placeholder = 'Cari nama, NISN, ujian…';
      searchInput.setAttribute('aria-label', 'Cari pelanggaran');

      const datePick = el('input');
      datePick.type = 'date';
      datePick.setAttribute('aria-label', 'Filter tanggal');

      const gradeSel = el('select');
      gradeSel.setAttribute('aria-label', 'Filter tingkatan');

      const classSel = el('select');
      classSel.setAttribute('aria-label', 'Filter kelas');

      const typeSel = el('select');
      typeSel.setAttribute('aria-label', 'Filter jenis pelanggaran');

      const refreshBtn = el('button', undefined, 'teacher-print-button');
      refreshBtn.type = 'button';
      refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Muat Ulang';

      const vGrades = [...new Set(data.pelanggaranList.map((x) => String(x.tingkat || '').trim()).filter(Boolean))].sort();
      const vClasses = [...new Set(data.pelanggaranList.map((x) => String(x.kelas || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
      const vTypes = [...new Set(data.pelanggaranList.map((x) => String(x.keterangan || '').trim()).filter(Boolean))].sort();

      gradeSel.append(new Option('Semua Tingkatan', 'ALL'), ...vGrades.map((x) => new Option(`Tingkat ${x}`, x)));
      classSel.append(new Option('Semua Kelas', 'ALL'), ...vClasses.map((x) => new Option(x, x)));
      typeSel.append(
        new Option('Semua Jenis', 'ALL'),
        ...vTypes.map((x) => new Option(humanizeViolation(x), x))
      );

      const vTable = el('div', undefined, 'teacher-result-table');

      const buildViolationOptions = (rawList) => {
        // Re-populate filter options saat data fresh
        const ng = [...new Set(rawList.map((x) => String(x.tingkat || '').trim()).filter(Boolean))].sort();
        const nc = [...new Set(rawList.map((x) => String(x.kelas || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id', { numeric: true }));
        const nt = [...new Set(rawList.map((x) => String(x.keterangan || '').trim()).filter(Boolean))].sort();

        const refill = (sel, all, items, labelFn = (x) => x) => {
          const cur = sel.value;
          sel.innerHTML = '';
          sel.append(new Option(all, 'ALL'), ...items.map((x) => new Option(labelFn(x), x)));
          sel.value = items.includes(cur) ? cur : 'ALL';
        };
        refill(gradeSel, 'Semua Tingkatan', ng, (x) => `Tingkat ${x}`);
        refill(classSel, 'Semua Kelas', nc);
        refill(typeSel, 'Semua Jenis', nt, humanizeViolation);
      };

      const renderViolations = (rawList) => {
        const query = searchInput.value.trim().toLowerCase();
        const dateVal = datePick.value;
        const gradeVal = gradeSel.value;
        const classVal = classSel.value;
        const typeVal = typeSel.value;

        const filtered = rawList.filter((x) =>
          (!dateVal || String(x.waktu || '').slice(0, 10) === dateVal) &&
          (gradeVal === 'ALL' || String(x.tingkat) === gradeVal) &&
          (classVal === 'ALL' || String(x.kelas) === classVal) &&
          (typeVal === 'ALL' || String(x.keterangan) === typeVal) &&
          (!query || `${x.nomor_ujian || ''} ${x.nama_siswa || ''} ${x.kelas || ''} ${x.nama_ujian || ''} ${x.keterangan || ''}`
            .toLowerCase().includes(query))
        );

        vTable.replaceChildren(table(
          ['Waktu (WIB)', 'No. Peserta', 'Nama Siswa', 'Kelas', 'Nama Ujian', 'Total', 'Jenis Pelanggaran'],
          filtered.map((x) => [
            fmtDatetime(x.waktu),
            x.nomor_ujian || '-',
            x.nama_siswa,
            x.kelas || '-',
            x.nama_ujian,
            createBadge(`${x.jumlah_pelanggaran}×`, 'red'),
            humanizeViolation(x.keterangan),
          ])
        ));
      };

      // Bind filter events
      [searchInput, datePick, gradeSel, classSel, typeSel].forEach((el) =>
        el.addEventListener('change', () => renderViolations(data.pelanggaranList))
      );
      searchInput.addEventListener('input', () => renderViolations(data.pelanggaranList));

      refreshBtn.addEventListener('click', async () => {
        refreshBtn.disabled = true;
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Memuat…';
        try {
          data = (await api('api/teacher/dashboard')).data;
          buildViolationOptions(data.pelanggaranList);
          renderViolations(data.pelanggaranList);
        } catch (err) {
          notice.style.color = '#c0392b';
          notice.textContent = `Gagal memuat data: ${err.message}`;
        } finally {
          refreshBtn.disabled = false;
          refreshBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Muat Ulang';
        }
      });

      const mkField = (label, inputEl) => {
        const f = el('label', undefined, 'teacher-filter-field');
        f.append(el('span', label), inputEl);
        return f;
      };

      filterBar.append(
        mkField('Cari', searchInput),
        mkField('Tanggal', datePick),
        mkField('Tingkatan', gradeSel),
        mkField('Kelas', classSel),
        mkField('Jenis', typeSel),
        refreshBtn,
      );

      box.append(filterBar, vTable);
      buildViolationOptions(data.pelanggaranList);
      renderViolations(data.pelanggaranList);
      content.append(box);
    }
  }

  async function openSection(section) {
    if (['overview', 'exams', 'results', 'violations'].includes(section)) {
      notice.style.color = 'var(--muted)';
      notice.textContent = 'Memuat data terbaru dari database...';
      try {
        data = (await api('api/teacher/dashboard')).data;
        notice.textContent = '';
      } catch (error) {
        notice.style.color = '#c0392b';
        notice.textContent = `Data terbaru gagal dimuat: ${error.message}`;
      }
    }
    render(section);
  }

  async function api(path, method = 'GET', body) {
    const response = await fetch('../' + path, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
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
    const teacherLabel = me.data.staff.nama || me.data.staff.name || me.data.staff.nama_lengkap || me.data.staff.nip || me.data.staff.username || 'Guru';
    document.getElementById('teacherName').textContent = teacherLabel;
    const sidebarName = document.getElementById('teacherSidebarName');
    const avatar = document.getElementById('teacherAvatar');
    const welcomeName = document.getElementById('teacherWelcomeName');
    if (sidebarName) sidebarName.textContent = teacherLabel;
    if (avatar) avatar.textContent = teacherLabel.trim().charAt(0).toUpperCase() || 'G';
    if (welcomeName) welcomeName.textContent = teacherLabel;
    data = (await api('api/teacher/dashboard')).data;
    render('overview');
  } catch (error) {
    notice.textContent = error.message;
  }

  const sidebar = document.getElementById('teacherSidebar');
  const menuButton = document.getElementById('menu');
  const sidebarBackdrop = document.getElementById('teacherSidebarBackdrop');
  const mobileLayout = window.matchMedia('(max-width: 800px)');

  const closeMobileSidebar = () => {
    sidebar.classList.remove('open');
    sidebarBackdrop.classList.remove('show');
    menuButton.setAttribute('aria-expanded', 'false');
  };

  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    openSection(button.dataset.section);
    if (mobileLayout.matches) {
      closeMobileSidebar();
    }
  }));
  content.addEventListener('click', (e) => {
    const button = e.target.closest('[data-target]');
    if (button) openSection(button.dataset.target);
  });
  menuButton.addEventListener('click', () => {
    if (mobileLayout.matches) {
      const isOpen = sidebar.classList.toggle('open');
      sidebarBackdrop.classList.toggle('show', isOpen);
      menuButton.setAttribute('aria-expanded', String(isOpen));
      return;
    }

    const laptopLayout = window.matchMedia('(max-width: 1180px)').matches;
    const className = laptopLayout ? 'expanded' : 'collapsed';
    const active = sidebar.classList.toggle(className);
    menuButton.setAttribute('aria-expanded', String(laptopLayout ? active : !active));
  });
  if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', closeMobileSidebar);

  // Sinkronkan seluruh menu guru secara berkala tanpa perlu memuat ulang halaman.
  setInterval(async () => {
    if (document.hidden || document.querySelector('.modal.show')) return;
    try {
      const fresh = (await api('api/teacher/dashboard')).data;
      const changed = JSON.stringify(fresh.ujianList) !== JSON.stringify(data.ujianList)
        || JSON.stringify(fresh.hasilList) !== JSON.stringify(data.hasilList)
        || JSON.stringify(fresh.pelanggaranList) !== JSON.stringify(data.pelanggaranList);
      data = fresh;
      if (changed) render(activeSection);
    } catch (_) {
      // Pertahankan data terakhir ketika sinkronisasi latar belakang gagal.
    }
  }, 15000);

  window.addEventListener('cbt:data-updated', async () => {
    try {
      data = (await api('api/teacher/dashboard')).data;
      render(activeSection);
    } catch (_) {
      // Refresh berkala akan mencoba kembali.
    }
  });

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
