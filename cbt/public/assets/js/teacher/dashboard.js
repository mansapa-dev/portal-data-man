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
    const titles={overview:'Dashboard',live:'Live Sessions',exams:'Ujian Diampu',results:'Hasil Siswa',violations:'Pelanggaran Ujian',account:'Ubah Password'};
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
      box.append(
        table(
          ['NISN', 'Nama Siswa', 'Kelas', 'Ujian', 'Nilai', 'Status'],
          data.hasilList.map((x) => [
            x.nomor_ujian,
            x.nama_siswa,
            x.kelas,
            x.nama_ujian,
            x.nilai !== undefined ? x.nilai : 0,
            createBadge(String(x.status || 'selesai').toUpperCase(), 'green')
          ])
        )
      );
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

    if (section === 'account') {
      const box = panel('Ubah Password', 'Perbarui kata sandi akun guru Anda untuk keamanan sistem (minimal 12 karakter).');
      const form = el('form');
      form.style.cssText = 'display:grid;gap:14px;max-width:440px';
      [
        ['Password Lama', 'old'],
        ['Password Baru', 'new']
      ].forEach(([label, id]) => {
        const wrap = el('label', label);
        wrap.style.cssText = 'display:grid;gap:6px;font-weight:700;font-size:12.5px';
        const input = el('input');
        input.type = 'password';
        input.id = id;
        input.required = true;
        input.style.cssText = 'padding:11px 14px;border:1.5px solid var(--line);border-radius:10px;font-size:13.5px;';
        wrap.append(input);
        form.append(wrap);
      });
      const button = el('button', 'Simpan Password Baru');
      button.style.cssText = 'border:0;border-radius:10px;padding:12px;background:var(--green);color:#fff;font-weight:700;cursor:pointer;margin-top:6px;box-shadow:0 4px 12px rgba(76,175,80,0.25);';
      form.append(button);
      form.addEventListener('submit', changePassword);
      box.append(form);
      content.append(box);
    }
  }

  async function changePassword(e) {
    e.preventDefault();
    try {
      await api('api/auth/password', 'POST', {
        old_password: document.getElementById('old').value,
        new_password: document.getElementById('new').value
      });
      notice.style.color = 'var(--green-dark)';
      notice.textContent = 'Password berhasil diperbarui.';
      e.target.reset();
    } catch (error) {
      notice.style.color = '#c0392b';
      notice.textContent = error.message;
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

  const btnLogoutSide = document.getElementById('logout');
  if (btnLogoutSide) btnLogoutSide.addEventListener('click', handleLogout);
  const btnLogoutTop = document.getElementById('topbarLogoutGuru');
  if (btnLogoutTop) btnLogoutTop.addEventListener('click', handleLogout);
})();
