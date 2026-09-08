const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function dashboard() {
  const container = {innerHTML:''};
  const started = [];
  const context = vm.createContext({
    document: { getElementById(id) { return id === 'formLoginSiswa' ? {addEventListener(){}} : container; } },
    setTimeout() {}, persiapkanUjian(exam) { started.push(exam.id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../public/assets/js/cbt/student-auth.js'),'utf8'), context);
  return {context,container,started};
}

test('completed exams stay disabled and terminated exams offer a support ticket', () => {
  const {context,container,started} = dashboard();
  context.renderDaftarJadwal([
    {id:1,nama_ujian:'Matematika',status_pengerjaan:'selesai',can_start:false},
    {id:2,nama_ujian:'Biologi',status_pengerjaan:'terblokir',can_start:false},
  ]);
  assert.match(container.innerHTML,/Matematika/);
  assert.match(container.innerHTML,/Biologi/);
  assert.equal((container.innerHTML.match(/disabled/g)||[]).length,1);
  assert.match(container.innerHTML,/openSupportTicket\('EXAM_LOCKED', 2\)/);
  context.persiapkanUjianById(1); context.persiapkanUjianById(2);
  assert.deepEqual(started,[]);
});

test('unstarted eligible and reset attempts can be opened; future exams cannot', () => {
  const {context,container,started} = dashboard();
  context.renderDaftarJadwal([
    {id:1,nama_ujian:'Susulan',status_pengerjaan:'belum',can_start:true},
    {id:2,nama_ujian:'Direset',status_pengerjaan:'berlangsung',can_start:true},
    {id:3,nama_ujian:'Besok',status_pengerjaan:'belum',can_start:false,availability_reason:'UPCOMING'},
  ]);
  assert.match(container.innerHTML,/Lanjutkan/);
  assert.match(container.innerHTML,/Belum Dimulai/);
  [1,2,3].forEach(id=>context.persiapkanUjianById(id));
  assert.deepEqual(started,[1,2]);
});
