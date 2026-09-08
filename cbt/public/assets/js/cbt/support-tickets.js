(function(){
  'use strict';
  let studentTimer=null,staffTimer=null,staffGeneration=0;
  const labels={ACCOUNT_ACCESS:'Akun / login',EXAM_LOCKED:'Ujian terkunci',PIN:'PIN',CONNECTION:'Koneksi',TECHNICAL:'Teknis',OTHER:'Lainnya'};
  const statuses={OPEN:'Baru',IN_PROGRESS:'Sedang ditangani',RESOLVED:'Selesai',CLOSED:'Ditutup'};
  const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
  const localTime=value=>value?new Date(String(value).replace(' ','T').replace(/Z?$/,'Z')).toLocaleString('id-ID',{timeZone:'Asia/Jakarta',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'-';
  const runCbt=(name,...args)=>new Promise((resolve,reject)=>cbtApi.withSuccessHandler(resolve).withFailureHandler(reject)[name](...args));
  function statusBadge(status){return el('span',statuses[status]||status,`support-status status-${String(status).toLowerCase()}`);}
  function studentRow(ticket){const row=el('article',undefined,'student-ticket-row'),head=el('div');head.append(el('strong',ticket.examName||labels[ticket.category]||'Bantuan CBT'),statusBadge(ticket.status));row.append(head,el('p',ticket.staffNote||ticket.message),el('small',`${ticket.handlerName?'Ditangani '+ticket.handlerName+' · ':''}${localTime(ticket.updatedAt)}`));return row;}
  async function loadStudentTickets(){
    clearTimeout(studentTimer);const section=document.getElementById('studentTicketStatusSection'),list=document.getElementById('studentTicketStatusList'),modal=document.getElementById('modalSupportTicket');
    if(!section||!list||typeof stSiswa==='undefined'||!stSiswa?.id)return;
    try{const result=await runCbt('getStudentSupportTickets');list.replaceChildren(...result.tickets.slice(0,5).map(studentRow));section.classList.toggle('hidden',!result.tickets.length);}
    catch(_){section.classList.add('hidden');}
    finally{if(modal?.classList.contains('show'))studentTimer=setTimeout(loadStudentTickets,10000);}
  }
  window.openSupportTicket=function(category='OTHER',examId=null){
    const modal=document.getElementById('modalSupportTicket'),categoryInput=document.getElementById('supportCategory'),nisn=document.getElementById('supportNisn'),nisnGroup=document.getElementById('supportNisnGroup'),examGroup=document.getElementById('supportExamGroup'),examInput=document.getElementById('supportExam'),feedback=document.getElementById('supportTicketFeedback');
    if(!modal)return;modal.dataset.examId=examId?String(examId):'';categoryInput.value=labels[category]?category:'OTHER';
    const loggedIn=typeof stSiswa!=='undefined'&&!!stSiswa?.id;nisnGroup.classList.toggle('hidden',loggedIn);nisn.required=!loggedIn;examGroup.classList.toggle('hidden',!loggedIn);
    if(loggedIn){nisn.value=stSiswa.no||stSiswa.id||'';const exams=typeof cacheStudentJadwal!=='undefined'?(cacheStudentJadwal||[]):[];examInput.replaceChildren(new Option('Tidak terkait ujian tertentu',''),...exams.map(exam=>new Option(`${exam.nama_ujian} · Sesi ${exam.sesi||1}`,String(exam.id))));examInput.value=examId?String(examId):'';}else if(document.getElementById('inNoUjian')?.value)nisn.value=document.getElementById('inNoUjian').value;
    feedback.className='alert';feedback.textContent='';modal.classList.add('show');if(loggedIn)loadStudentTickets();
  };
  function closeStudentModal(){document.getElementById('modalSupportTicket')?.classList.remove('show');clearTimeout(studentTimer);}
  const form=document.getElementById('formSupportTicket');
  if(form){
    document.getElementById('btnCloseSupportTicket')?.addEventListener('click',closeStudentModal);document.getElementById('btnCancelSupportTicket')?.addEventListener('click',closeStudentModal);
    form.addEventListener('submit',async event=>{event.preventDefault();const button=document.getElementById('btnSendSupportTicket'),feedback=document.getElementById('supportTicketFeedback'),modal=document.getElementById('modalSupportTicket');button.disabled=true;feedback.className='alert';feedback.textContent='Mengirim permintaan…';
      try{const payload={nisn:document.getElementById('supportNisn').value,category:document.getElementById('supportCategory').value,message:document.getElementById('supportMessage').value,exam_id:document.getElementById('supportExam').value||modal.dataset.examId||null};const result=await runCbt('createSupportTicket',payload);feedback.className='alert success';feedback.textContent=result.message||'Tiket sudah diterima petugas.';document.getElementById('supportMessage').value='';if(typeof stSiswa!=='undefined'&&stSiswa?.id)loadStudentTickets();}
      catch(error){feedback.className='alert error';feedback.textContent=error.message;}
      finally{button.disabled=false;}
    });
  }
  function staffCard(ticket,client,isAdmin,refresh){
    const card=el('article',undefined,'support-ticket-card'),head=el('header'),identity=el('div'),meta=el('div',undefined,'support-ticket-meta');
    identity.append(el('h3',ticket.studentName),el('p',`${ticket.nisn} · ${ticket.className||'-'}`));head.append(identity,statusBadge(ticket.status));
    meta.append(el('span',labels[ticket.category]||ticket.category),el('span',ticket.examName||'Kendala akun'),el('span',localTime(ticket.createdAt)));card.append(head,meta,el('p',ticket.message,'support-ticket-message'));
    if(ticket.staffNote){const note=el('div',undefined,'support-staff-note');note.append(el('strong',ticket.handlerName||'Petugas'),el('span',ticket.staffNote));card.append(note);}
    if(!['RESOLVED','CLOSED'].includes(ticket.status)){
      const textarea=el('textarea',undefined,'support-note-input');textarea.rows=2;textarea.maxLength=1000;textarea.placeholder='Catatan untuk siswa (opsional)';const actions=el('div',undefined,'support-ticket-actions');
      if(ticket.status==='OPEN'){const take=el('button','Ambil tiket','btn btn-secondary');take.type='button';take.addEventListener('click',()=>act(take,()=>client.update(ticket.id,'IN_PROGRESS',textarea.value),refresh));actions.append(take);}
      const solve=el('button','Tandai selesai','btn btn-success');solve.type='button';solve.addEventListener('click',()=>act(solve,()=>client.update(ticket.id,'RESOLVED',textarea.value||'Kendala telah ditangani petugas.'),refresh));actions.append(solve);
      if(isAdmin&&ticket.canReset){const reset=el('button','Reset CBT & selesaikan','btn btn-danger');reset.type='button';reset.addEventListener('click',()=>act(reset,()=>client.reset(ticket.id,textarea.value.trim()||'Reset melalui tiket bantuan siswa'),refresh));actions.append(reset);}
      card.append(textarea,actions);
    }
    return card;
  }
  async function act(button,request,refresh){button.disabled=true;try{await request();await refresh();}catch(error){alert(error.message);}finally{button.disabled=false;}}
  function stopStaff(){staffGeneration+=1;clearTimeout(staffTimer);staffTimer=null;}
  function mountStaff(root,client,isAdmin=false,notice=null,statusGetter=()=> 'ALL'){
    stopStaff();const generation=staffGeneration;
    const load=async()=>{if(generation!==staffGeneration)return;try{const tickets=await client.list(statusGetter());if(generation!==staffGeneration)return;root.replaceChildren(...tickets.map(ticket=>staffCard(ticket,client,isAdmin,load)));if(!tickets.length)root.append(el('div','Belum ada tiket pada status ini.','support-empty'));if(notice){notice.className='alert';notice.textContent='';}}
      catch(error){if(notice){notice.className='alert error';notice.textContent=error.message;}if(!root.children.length)root.append(el('div','Tiket belum dapat dimuat.','support-empty'));}
      finally{if(generation===staffGeneration)staffTimer=setTimeout(load,10000);}};load();return load;
  }
  window.loadDataSupportTickets=function(){const root=document.getElementById('supportAdminList');if(!root)return;const summary=document.getElementById('supportAdminSummary'),notice=document.getElementById('supportAdminNotice');const client={list:async status=>{const r=await runCbt('getStaffSupportTickets',status);summary.textContent=`${r.tickets.length} tiket ditampilkan`;return r.tickets;},update:(id,status,note)=>runCbt('updateSupportTicket',id,status,note),reset:(id,reason)=>runCbt('resetSupportTicket',id,reason)};mountStaff(root,client,true,notice,()=>document.getElementById('supportAdminStatus')?.value||'ALL');};
  window.CbtSupportTickets={mountStaff,stopStaff};
})();
