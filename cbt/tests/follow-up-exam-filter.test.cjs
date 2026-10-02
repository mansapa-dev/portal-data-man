const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'js', 'cbt', 'follow-up-exams.js'), 'utf8');
const form = {addEventListener() {}};
const controls = {
  fltMakeupExam: {value: '2'}, fltMakeupGrade: {value: 'XII'}, fltMakeupDate: {value: ''}, fltMakeupClass: {value: 'ALL'}, fltMakeupSubject: {value: 'ALL'}, fltMakeupStatus: {value: 'ALL'},
  fltRetakeExam: {value: '1'}, fltRetakeSearch: {value: ''}, fltRetakeGrade: {value: 'ALL'}, fltRetakeClass: {value: 'ALL'}, fltRetakeStatus: {value: 'ALL'},
  fltScheduleExam: {value: '11'}, fltScheduleGrade: {value: 'XI'}, fltScheduleSearch: {value: ''}, fltScheduleType: {value: 'ALL'}, fltScheduleState: {value: 'ALL'},
};
const context = vm.createContext({
  console,
  document: {getElementById: id => id === 'formUjianLanjutan' ? form : controls[id]},
  ...controls,
});

vm.runInContext(`${source}\nglobalThis.testFilters = (makeup, retake, schedules) => {
  makeUpCandidates = makeup;
  retakeCandidates = retake;
  followUpSchedules = schedules;
  renderMakeUpCandidates = rows => { globalThis.makeupResult = rows; };
  renderRetakeCandidates = rows => { globalThis.retakeResult = rows; };
  renderFollowUpSchedules = rows => { globalThis.scheduleResult = rows; };
  filterMakeupCandidates();
  filterRetakeCandidates();
  filterFollowUpSchedules();
};`, context);

test('filter nama ujian memakai ID agar ujian bernama sama tidak tercampur', () => {
  context.testFilters(
    [{exam_id: 1, exam_name: 'PAS', grade: 'XII', status_susulan: 'BELUM_UJIAN'}, {exam_id: 2, exam_name: 'PAS', grade: 'XI', status_susulan: 'BELUM_UJIAN'}, {exam_id: 2, exam_name: 'PAS', grade: 'XII', status_susulan: 'BELUM_UJIAN'}],
    [{exam_id: 1, exam_name: 'PAS', status_retake: 'PENDING'}, {exam_id: 2, exam_name: 'PAS', status_retake: 'PENDING'}],
    [{id: 10, name: 'PAS - Susulan', grade: 'XI', type: 'SUSULAN', execution_state: 'UPCOMING'}, {id: 11, name: 'PAS - Susulan', grade: 'X', type: 'SUSULAN', execution_state: 'UPCOMING'}, {id: 11, name: 'PAS - Susulan', grade: 'XI', type: 'SUSULAN', execution_state: 'UPCOMING'}],
  );

  assert.deepEqual(Array.from(context.makeupResult, item => item.exam_id), [2]);
  assert.deepEqual(Array.from(context.retakeResult, item => item.exam_id), [1]);
  assert.deepEqual(Array.from(context.scheduleResult, item => item.id), [11]);
});
