(function () {
  'use strict';

  const labels = { TECHNICAL: 'Kendala teknis', ASSISTANCE: 'Permintaan bantuan', EXAM_REPORT: 'Laporan ujian', EMERGENCY: 'Darurat', OTHER: 'Lainnya' };
  const statuses = { OPEN: 'Baru', READ: 'Dibaca', IN_PROGRESS: 'Diproses', RESOLVED: 'Selesai' };
  const statusIcons = { OPEN: 'fa-circle-exclamation', READ: 'fa-envelope-open', IN_PROGRESS: 'fa-spinner', RESOLVED: 'fa-circle-check' };
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (cls) node.className = cls; return node; };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const formatDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }); };
  const imageData = file => new Promise((resolve, reject) => { if (!file) return resolve(''); if (file.size > 2000000) return reject(new Error('Lampiran maksimal 2 MB.')); const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Lampiran gagal dibaca.')); reader.readAsDataURL(file); });

  function mount(root, api, { admin = false } = {}) {
    if (typeof root.__staffChatDestroy === 'function') root.__staffChatDestroy();
    let selected = null, timer = null, threads = [], loading = false;
    root.replaceChildren();
    const layout = el('div', undefined, 'staff-chat-layout'), side = el('section', undefined, 'staff-chat-side'), main = el('section', undefined, 'staff-chat-main');
    const head = el('div', undefined, 'staff-chat-head'), heading = el('div');
    heading.innerHTML = `<h3>${admin ? 'Kotak masuk petugas' : 'Komunikasi Admin Sekolah'}</h3><small>Memuat percakapan…</small>`;
    const refreshButton = el('button', undefined, 'btn btn-secondary staff-chat-refresh');
    refreshButton.type = 'button';
    refreshButton.innerHTML = `<i class="fa-solid ${admin ? 'fa-rotate' : 'fa-plus'}"></i><span>${admin ? 'Perbarui' : 'Pesan baru'}</span>`;
    head.append(heading, refreshButton);
    const tools = el('div', undefined, 'staff-chat-tools');
    tools.innerHTML = `<label class="staff-chat-search"><i class="fa-solid fa-magnifying-glass"></i><input type="search" placeholder="Cari petugas atau pesan…" aria-label="Cari percakapan"></label>${admin ? `<select aria-label="Filter status"><option value="ALL">Semua status</option>${Object.entries(statuses).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>` : ''}`;
    const list = el('div', undefined, 'staff-chat-threads');
    side.append(head, tools, list); layout.append(side, main); root.append(layout);

    const showWelcome = () => { main.innerHTML = '<div class="staff-chat-welcome"><span><i class="fa-solid fa-comments"></i></span><h3>Pilih percakapan petugas</h3><p>Buka laporan di sebelah kiri untuk membaca pesan, mengirim balasan, atau memperbarui status penanganan.</p></div>'; };
    const renderThreads = () => {
      const query = tools.querySelector('input').value.trim().toLowerCase(), status = tools.querySelector('select')?.value || 'ALL';
      const visible = threads.filter(thread => (status === 'ALL' || thread.status === status) && [thread.subject, thread.creatorName, thread.lastMessage, labels[thread.category]].some(value => String(value || '').toLowerCase().includes(query)));
      const unread = threads.reduce((sum, thread) => sum + Number(thread.unread || 0), 0);
      heading.querySelector('small').textContent = `${threads.length} percakapan${unread ? ` · ${unread} pesan belum dibaca` : ''}`;
      list.replaceChildren(...visible.map(thread => {
        const button = el('button', undefined, `staff-chat-thread${thread.id === selected ? ' active' : ''}${thread.unread ? ' unread' : ''}`);
        button.type = 'button';
        button.innerHTML = `<div class="staff-chat-thread-top"><span class="staff-chat-avatar">${escapeHtml((thread.creatorName || '?').charAt(0).toUpperCase())}</span><span class="staff-chat-thread-title"><b>${escapeHtml(thread.subject)}</b><small>${escapeHtml(thread.creatorName)}</small></span><time>${escapeHtml(formatDate(thread.updatedAt))}</time></div><div class="staff-chat-thread-meta"><span class="staff-chat-category">${escapeHtml(labels[thread.category] || thread.category)}</span><span class="staff-chat-status status-${String(thread.status).toLowerCase()}"><i class="fa-solid ${statusIcons[thread.status] || 'fa-circle'}"></i>${escapeHtml(statuses[thread.status] || thread.status)}</span>${thread.unread ? `<em>${thread.unread} baru</em>` : ''}</div><p>${escapeHtml(thread.lastMessage || 'Belum ada isi pesan')}</p>`;
        button.onclick = () => openThread(thread);
        return button;
      }));
      if (!visible.length) list.innerHTML = `<div class="support-empty"><i class="fa-solid fa-inbox"></i><b>${threads.length ? 'Percakapan tidak ditemukan' : 'Belum ada percakapan'}</b><span>${threads.length ? 'Ubah kata pencarian atau filter status.' : 'Laporan dari petugas akan tampil di sini.'}</span></div>`;
    };
    const loadThreads = async ({ quiet = false } = {}) => {
      if (loading) return threads;
      loading = true; if (!quiet) refreshButton.classList.add('is-loading');
      try { threads = (await api('api/staff/admin-communications')).data || []; renderThreads(); return threads; }
      catch (error) { if (!quiet) list.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; return []; }
      finally { loading = false; refreshButton.classList.remove('is-loading'); }
    };
    const compose = () => {
      selected = null; renderThreads(); main.replaceChildren();
      const form = el('form', undefined, 'staff-chat-form');
      form.innerHTML = `<div class="staff-chat-form-title"><span><i class="fa-solid fa-paper-plane"></i></span><div><h3>Pesan baru kepada admin</h3><p>Jelaskan kebutuhan atau kendala ujian secara singkat dan jelas.</p></div></div><label>Kategori<select name="category">${Object.entries(labels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label><label>Subjek<input name="subject" maxlength="180" required placeholder="Contoh: Peserta tidak dapat melanjutkan ujian"></label><label>Pesan<textarea name="message" maxlength="2000" rows="6" required placeholder="Tuliskan kronologi dan bantuan yang diperlukan…"></textarea></label><label>Lampiran gambar <small>Opsional · PNG, JPG, atau WebP · maks. 2 MB</small><input name="attachment" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="staff-chat-form-actions"><button class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> Kirim ke admin</button></div><div class="alert" hidden></div>`;
      form.onsubmit = async event => { event.preventDefault(); const submit = form.querySelector('button'), notice = form.querySelector('.alert'); submit.disabled = true; try { await api('api/staff/admin-communications', 'POST', { category: form.category.value, subject: form.subject.value, message: form.message.value, attachment: await imageData(form.attachment.files[0]) }); notice.hidden = false; notice.className = 'alert success'; notice.textContent = 'Pesan berhasil dikirim.'; form.reset(); await loadThreads(); } catch (error) { notice.hidden = false; notice.className = 'alert error'; notice.textContent = error.message; } finally { submit.disabled = false; } };
      main.append(form);
    };
    const openThread = async thread => {
      selected = thread.id; renderThreads();
      main.innerHTML = '<div class="staff-chat-loading"><i class="fa-solid fa-spinner fa-spin"></i> Memuat percakapan…</div>';
      try {
        const messages = (await api(`api/staff/admin-communications/${thread.id}`)).data || [], box = el('div', undefined, 'staff-chat-conversation'), conversationHead = el('header');
        conversationHead.innerHTML = `<div class="staff-chat-contact"><span class="staff-chat-avatar large">${escapeHtml((thread.creatorName || '?').charAt(0).toUpperCase())}</span><div><h3>${escapeHtml(thread.subject)}</h3><p><b>${escapeHtml(thread.creatorName)}</b><span>${escapeHtml(labels[thread.category] || thread.category)}</span></p></div></div>`;
        if (admin) {
          const statusControl = el('label', undefined, 'staff-chat-status-control');
          statusControl.innerHTML = `<span>Status penanganan</span><select>${Object.entries(statuses).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
          const select = statusControl.querySelector('select'); select.value = thread.status;
          select.onchange = async () => { const previous = thread.status; select.disabled = true; try { await api(`api/staff/admin-communications/${thread.id}/status`, 'POST', { status: select.value }); thread.status = select.value; await loadThreads(); await openThread(thread); } catch (error) { select.value = previous; window.alert(error.message); } finally { select.disabled = false; } };
          conversationHead.append(statusControl);
        }
        const stream = el('div', undefined, 'staff-chat-messages');
        if (!messages.length) stream.innerHTML = '<div class="support-empty">Belum ada pesan dalam percakapan ini.</div>';
        messages.forEach(message => {
          const item = el('article', undefined, `staff-chat-message${message.mine ? ' mine' : ''}`);
          item.innerHTML = `<div class="staff-chat-message-author"><b>${escapeHtml(message.senderName)}</b><span>${escapeHtml(message.senderRole === 'ADMIN' ? 'Admin' : 'Petugas')}</span></div><p>${escapeHtml(message.message)}</p>`;
          if (message.attachment) { const link = el('a', undefined, 'staff-chat-attachment'); link.href = (admin ? '' : '../') + message.attachment; link.target = '_blank'; link.rel = 'noopener'; link.innerHTML = '<i class="fa-solid fa-image"></i> Lihat lampiran gambar'; item.append(link); }
          item.insertAdjacentHTML('beforeend', `<small>${escapeHtml(formatDate(message.sentAt))}${message.mine && message.readAt ? ' · Dibaca' : ''}</small>`); stream.append(item);
        });
        box.append(conversationHead, stream);
        if (thread.status !== 'RESOLVED') {
          const reply = el('form', undefined, 'staff-chat-reply');
          reply.innerHTML = '<div class="staff-chat-reply-field"><textarea name="message" rows="3" maxlength="2000" placeholder="Tulis balasan untuk petugas…" required aria-label="Balasan"></textarea><span class="staff-chat-character-count">0/2000</span></div><div class="staff-chat-reply-actions"><label class="staff-chat-file"><i class="fa-solid fa-paperclip"></i><span>Lampirkan gambar</span><input name="attachment" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> Kirim balasan</button></div><div class="alert" hidden></div>';
          const textarea = reply.querySelector('textarea'); textarea.oninput = () => { reply.querySelector('.staff-chat-character-count').textContent = `${textarea.value.length}/2000`; };
          reply.onsubmit = async event => { event.preventDefault(); const button = reply.querySelector('button'), notice = reply.querySelector('.alert'); button.disabled = true; try { await api(`api/staff/admin-communications/${thread.id}/messages`, 'POST', { message: reply.message.value, attachment: await imageData(reply.attachment.files[0]) }); await openThread({ ...thread, status: admin ? 'IN_PROGRESS' : 'OPEN' }); } catch (error) { notice.hidden = false; notice.className = 'alert error'; notice.textContent = error.message; } finally { button.disabled = false; } };
          box.append(reply);
        } else box.insertAdjacentHTML('beforeend', '<div class="staff-chat-resolved"><i class="fa-solid fa-circle-check"></i><div><b>Percakapan telah diselesaikan</b><span>Ubah status penanganan jika percakapan perlu dibuka kembali.</span></div></div>');
        main.replaceChildren(box); stream.scrollTop = stream.scrollHeight; await loadThreads({ quiet: true });
      } catch (error) { main.innerHTML = `<div class="alert error">${escapeHtml(error.message)}</div>`; }
    };
    tools.querySelector('input').addEventListener('input', renderThreads);
    tools.querySelector('select')?.addEventListener('change', renderThreads);
    refreshButton.onclick = admin ? () => loadThreads() : compose;
    if (admin) showWelcome(); else compose();
    loadThreads(); timer = setInterval(() => loadThreads({ quiet: true }), 15000);
    root.__staffChatDestroy = () => clearInterval(timer);
    return root.__staffChatDestroy;
  }
  window.CbtStaffAdminChat = { mount };
})();
