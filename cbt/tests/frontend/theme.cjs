const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../../public/assets/js/dashboard-design.js'), 'utf8');
function boot(values, blocked = false) {
  let ready, click;
  const attrs = {};
  const button = { setAttribute(k,v){attrs[k]=v}, getAttribute(k){return attrs[k]}, addEventListener(k,v){click=v} };
  const document = { documentElement:{dataset:{}}, querySelectorAll: selector => selector === '[data-theme-toggle]' ? [button] : [], addEventListener: (_,fn) => {ready=fn} };
  vm.runInNewContext(source, {document, localStorage:{getItem(k){if(blocked)throw Error('blocked');return values[k]},setItem(k,v){if(blocked)throw Error('blocked');values[k]=v}}});
  ready();return {document,attrs,toggle:()=>click()};
}
const prior = {'mansapa-dashboard-theme':'dark'};
let state=boot(prior);
assert.equal(state.document.documentElement.dataset.theme,'light','Legacy/system theme must not force CBT dark');
state.toggle();assert.equal(prior['mansapa-cbt-theme-v2'],'dark');assert.equal(state.attrs['aria-pressed'],'true');
assert.equal(boot(prior).document.documentElement.dataset.theme,'dark','Explicit preference should persist');
state=boot({},true);assert.equal(state.document.documentElement.dataset.theme,'light');state.toggle();assert.equal(state.document.documentElement.dataset.theme,'dark');
assert.equal(boot({'mansapa-cbt-theme-v2':'invalid'}).document.documentElement.dataset.theme,'light');
console.log('PASS: white default, legacy migration, explicit dark persistence, toggle accessibility, unavailable storage');
