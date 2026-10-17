import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { exportExcel } from './lib/spreadsheet';
import { defaultReportIdentity, escapePrint, letterheadRows, printBaseCss, printLetterhead, schoolLogoPath } from './lib/print-format';

type StudentRow={id:number;nisn:string;name_snapshot:string;class_snapshot:string|null;grade_snapshot:string|null};
type ClassRow={portal_class_id:string;name:string;grade:string};

export function StudentCards(){
 const [grade,setGrade]=useState(''),[className,setClassName]=useState(''),[classes,setClasses]=useState<ClassRow[]>([]),[students,setStudents]=useState<StudentRow[]>([]),[page,setPage]=useState(1),[total,setTotal]=useState(0),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 async function load(nextPage:number,nextGrade=grade,nextClass=className){setBusy(true);setNotice('');try{const params=new URLSearchParams({page:String(nextPage),limit:'50'});if(nextGrade)params.set('grade',nextGrade);if(nextClass)params.set('class_id',nextClass);const result=await api<{items:StudentRow[];total:number}>(`/api/admin/students?${params}`);setStudents(result.items);setTotal(result.total);setPage(nextPage);}catch(error){setNotice(error instanceof Error?error.message:'Kartu peserta gagal dimuat');}finally{setBusy(false);}}
 useEffect(()=>{void api<ClassRow[]>('/api/admin/portal-classes').then(setClasses).catch(()=>undefined);},[]);
 useEffect(()=>{void load(1);},[]);
 async function allFiltered(){const items:StudentRow[]=[];for(let next=1;next<=100;next++){const params=new URLSearchParams({page:String(next),limit:'100'});if(grade)params.set('grade',grade);if(className)params.set('class_id',className);const response=await api<{items:StudentRow[];total:number}>(`/api/admin/students?${params}`);items.push(...response.items);if(items.length>=response.total||response.items.length<100)return items;}throw new Error('Daftar melebihi 10.000 peserta. Saring tingkat atau kelas terlebih dahulu.');}
 async function printCards(){
  const pageWindow=window.open('','arena-participant-cards','width=900,height=700');
  if(!pageWindow){setNotice('Izinkan pop-up untuk mencetak kartu.');return;}
  pageWindow.document.write('<p>Menyiapkan kartu peserta…</p>');setBusy(true);setNotice('');
  try{
   const items=await allFiltered();
   const cards=items.map(item=>'<article class="card">'+printLetterhead(defaultReportIdentity,true)+'<table><tbody><tr><th>No Peserta</th><td>'+escapePrint(item.nisn)+'</td></tr><tr><th>Nama</th><td><b>'+escapePrint(item.name_snapshot)+'</b></td></tr><tr><th>Kelas / Tingkat</th><td>'+escapePrint(item.class_snapshot)+' / '+escapePrint(item.grade_snapshot)+'</td></tr></tbody></table></article>').join('');
   pageWindow.document.open();
   pageWindow.document.write('<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Kartu Peserta Arena</title><style>'+printBaseCss+'.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{border:1.5px solid #315b3e;border-radius:8px;padding:12px;break-inside:avoid}.card th,.card td{border:0;padding:4px}.card th{width:35%;font-weight:400}.card td{overflow-wrap:anywhere}@page{size:A4 portrait;margin:10mm}@media print{.grid{gap:8px}}</style></head><body><button onclick="window.print()">Cetak / simpan PDF</button><p>'+items.length+' kartu identitas peserta. PIN diberikan secara terpisah oleh petugas.</p><div class="grid">'+cards+'</div></body></html>');
   pageWindow.document.close();
  }catch(error){pageWindow.close();setNotice(error instanceof Error?error.message:'Kartu gagal disiapkan');}finally{setBusy(false);}
 }
 async function exportCards(){
  setBusy(true);setNotice('');
  try{
   const items=await allFiltered();
   await exportExcel('kartu-peserta-arena.xlsx',[
    {name:'Identitas Sekolah',autofilter:false,rows:[...letterheadRows(defaultReportIdentity),[],['DAFTAR KARTU PESERTA UJIAN'],['Tanggal',new Date().toLocaleDateString('id-ID',{timeZone:'Asia/Jakarta'})],['Jumlah peserta',items.length],['PIN','Dibagikan terpisah kepada peserta']],widths:[42,55]},
    {name:'Peserta',rows:[['NISN','Nama peserta','Kelas','Tingkat'],...items.map(item=>[item.nisn,item.name_snapshot,item.class_snapshot,item.grade_snapshot])],widths:[20,36,22,12]},
   ]);
   setNotice(items.length+' kartu peserta diekspor.');
  }catch(error){setNotice(error instanceof Error?error.message:'Ekspor gagal');}finally{setBusy(false);}
 }
 return <section className="admin-page-card"><header className="admin-card-heading"><div><span className="section-kicker">IDENTITAS PESERTA</span><h2>Kartu peserta ujian</h2><p>Cetak kartu identitas dari data siswa tersimpan. PIN baru hanya tersedia sesaat setelah diterbitkan.</p></div><div className="operations-monitor-actions"><button type="button" className="btn btn-primary" disabled={busy||!students.length} onClick={()=>void printCards()}>Cetak semua sesuai filter</button><button type="button" className="btn btn-secondary" disabled={busy||!students.length} onClick={()=>void exportCards()}>Unduh Excel</button></div></header>{notice&&<p role="alert" className="arena-notice">{notice}</p>}<form className="admin-result-filters" onSubmit={event=>{event.preventDefault();void load(1);}}><label>Tingkat<select value={grade} onChange={event=>{setGrade(event.target.value);setClassName('');}}><option value="">Semua tingkat</option>{['X','XI','XII'].map(item=><option key={item}>{item}</option>)}</select></label><label>Kelas<select value={className} onChange={event=>setClassName(event.target.value)}><option value="">Semua kelas</option>{classes.filter(item=>!grade||item.grade===grade).map(item=><option key={item.portal_class_id} value={item.portal_class_id}>{item.name}</option>)}</select></label><button className="btn btn-secondary" disabled={busy}>Tampilkan</button></form><div className="student-card-preview">{students.map(item=><article key={item.id}><div className="student-card-brand"><img src={schoolLogoPath} alt="Lambang MAN 1 Palembang"/><small>MAN 1 PALEMBANG<br/>KARTU PESERTA UJIAN</small></div><strong>{item.name_snapshot}</strong><span>NISN {item.nisn}</span><span>{item.class_snapshot??'Kelas belum tercatat'}</span></article>)}</div>{!students.length&&<p className="operations-empty">Belum ada peserta sesuai filter.</p>}<div className="operations-pagination"><span>Halaman {page} · {total} peserta</span><button className="btn btn-secondary" disabled={busy||page<=1} onClick={()=>void load(page-1)}>Sebelumnya</button><button className="btn btn-secondary" disabled={busy||page*50>=total} onClick={()=>void load(page+1)}>Berikutnya</button></div></section>;
}
