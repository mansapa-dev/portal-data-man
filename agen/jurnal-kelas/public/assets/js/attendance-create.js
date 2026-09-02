const csrf=document.querySelector('meta[name="csrf-token"]').content;
const form=document.querySelector('#create-attendance'),error=document.querySelector('#form-error');
const classSelect=form.elements.classPublicId,semesterSelect=form.elements.semesterPublicId,subjectSelect=form.elements.subjectPublicId;
const get=async url=>{const response=await fetch(url,{credentials:'same-origin'}),body=await response.json();if(!response.ok)throw new Error(body.message||'Data gagal dimuat.');return body.data};
let periods=[];
try{
 const [classes,years,subjects]=await Promise.all([get('/api/classes'),get('/api/periods'),get('/api/subjects')]);periods=years;
 classSelect.innerHTML='<option value="">Pilih kelas</option>'+classes.map(item=>`<option value="${item.publicId}" data-year="${item.academicYear?.publicId??''}">${item.code} · ${item.name}</option>`).join('');
 subjectSelect.innerHTML='<option value="">Pilih mata pelajaran</option>'+subjects.map(item=>`<option value="${item.publicId}">${item.name}</option>`).join('');
}catch(e){error.textContent=e.message;error.hidden=false}
classSelect.addEventListener('change',()=>{const yearId=classSelect.selectedOptions[0]?.dataset.year,year=periods.find(item=>item.publicId===yearId),semesters=year?.semesters??[];semesterSelect.innerHTML='<option value="">Pilih semester</option>'+semesters.map(item=>`<option value="${item.publicId}">${item.type==='ODD'?'Ganjil':'Genap'}${item.isActive?' · Aktif':''}</option>`).join('')});
form.addEventListener('submit',async event=>{event.preventDefault();error.hidden=true;const button=form.querySelector('button[type="submit"]');button.disabled=true;try{const payload=Object.fromEntries(new FormData(form));payload.periodStart=Number(payload.periodStart);payload.periodEnd=Number(payload.periodEnd);const response=await fetch('/api/attendance',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(payload)}),body=await response.json();if(!response.ok)throw new Error(body.message||'Draft gagal dibuat.');AgenToast.success('Sesi absensi berhasil dibuat.',{persist:true});location.assign(`/attendance/${body.data.session.publicId}`)}catch(e){error.textContent=e.message;error.hidden=false;AgenToast.error(e.message);button.disabled=false}});
