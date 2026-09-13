const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../public/assets/js/attendance-create.js'), 'utf8');
class Option {
    constructor(text, value) { this.textContent = text; this.value = value; this.dataset = {}; }
}
class Select {
    constructor() { this.options = []; this.value = ''; this.listeners = {}; }
    replaceChildren(...options) { this.options = options; this.value = options[0]?.value || ''; }
    add(option) { this.options.push(option); }
    get selectedOptions() { return this.options.filter(o => o.value === this.value); }
    addEventListener(type, callback) { this.listeners[type] = callback; }
    change(value) { this.value = value; this.listeners.change(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
(async () => {
    const classes = new Select(), semesters = new Select(), subjects = new Select();
    const button = {}, error = {hidden:true}, status = {}, listeners = {}, calls = [], pending = [];
    const form = {elements:{classPublicId:classes,semesterPublicId:semesters,subjectPublicId:subjects},querySelector:()=>button,addEventListener:(type,cb)=>listeners[type]=cb};
    const document = {querySelector:selector => ({'meta[name="csrf-token"]':{content:'csrf'},'#create-attendance':form,'#form-error':error,'#roster-status':status})[selector]};
    const response = data => ({ok:true,json:async()=>({success:true,data})});
    const fetch = async url => {
        calls.push(url);
        if(url.startsWith('/api/classes?')) return response([{publicId:'xi4',code:'XI.4',name:'XI 4',academicYear:{publicId:'year'}}]);
        if(url.startsWith('/api/periods?')) return response([{publicId:'year',semesters:[{publicId:'odd',type:'ODD',isActive:true},{publicId:'even',type:'EVEN',isActive:false}]}]);
        if(url==='/api/subjects') return response([{publicId:'subject',name:'Subject'}]);
        return new Promise(resolve=>pending.push(data=>resolve(response(data))));
    };
    await vm.runInNewContext(`(async()=>{${source}})()`,{document,Option,fetch,console,encodeURIComponent});
    assert(calls.includes('/api/classes?refresh=1') && calls.includes('/api/periods?refresh=1'),'refresh login-time references');
    classes.change('xi4');
    assert.equal(semesters.value,'odd','select active semester belonging to selected class year');
    assert.equal(calls.at(-1),'/api/classes/xi4/students?semesterPublicId=odd');
    assert.equal(button.disabled,true,'do not submit before roster arrives');
    pending.shift()({class:{name:'XI 4'},semester:{type:'ODD'},academicYear:{name:'2026/2027'},students:[]});
    await tick();
    assert.equal(button.disabled,true,'empty selected semester blocks session creation');
    assert.match(error.textContent,/XI 4.*Ganjil.*2026\/2027/);
    assert.equal(semesters.value,'odd','never fall back to a different semester for students');
    const before=calls.length;
    await listeners.submit({preventDefault(){}});
    assert.equal(calls.length,before,'empty roster cannot create attendance');
    semesters.change('even');
    semesters.change('odd');
    pending.pop()({semester:{type:'ODD'},students:[{},{}]});
    await tick();
    assert.equal(button.disabled,false);
    assert.match(status.textContent,/2 siswa.*Ganjil/);
    pending.shift()({semester:{type:'EVEN'},students:[]});
    await tick();
    assert.equal(button.disabled,false,'stale response cannot overwrite latest selected semester');
    assert.match(status.textContent,/2 siswa.*Ganjil/);
    semesters.change('even');
    pending.shift()({semester:{type:'EVEN'}});
    await tick();
    assert.equal(button.disabled,true);
    assert.match(error.textContent,/tidak valid/,'malformed roster is not presented as an empty class');
    console.log('PASS: fresh references, active semester, exact XI 4 roster, empty/malformed roster, blocked submit, stale response protection');
})().catch(error=>{console.error(error);process.exitCode=1;});
