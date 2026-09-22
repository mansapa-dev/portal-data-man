const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

let modal;
const document = {
  querySelectorAll: () => [],
  getElementById: id => id === 'modalQuestionEquation' ? modal : null
};
const context = vm.createContext({ document });
const source = fs.readFileSync(path.join(__dirname, '../public/assets/js/cbt/question-editor-tools.js'), 'utf8');
vm.runInContext(source, context);

function equation(type, values, rows = 3, cols = 3) {
  modal = {
    querySelector: selector => {
      if (selector === '#questionEquationType') return { value: type };
      if (selector === '#questionMatrixRows') return { value: rows };
      if (selector === '#questionMatrixCols') return { value: cols };
      return null;
    },
    querySelectorAll: selector => {
      if (selector === '[data-equation-value]') return values.map(value => ({ value }));
      if (selector === '[data-matrix-cell]') return values.map(value => ({ value }));
      return [];
    }
  };
  return context.buildQuestionMathMl();
}

const matrix4 = equation('matrix', Array.from({ length: 16 }, (_, i) => String(i + 1)), 4, 4);
assert.equal((matrix4.match(/<mtr>/g) || []).length, 4);
assert.equal((matrix4.match(/<mtd>/g) || []).length, 16);
assert.match(matrix4, /display="inline"/);
assert.match(matrix4, /<mo>\[<\/mo><mtable>/);

const matrix12 = equation('matrix', Array.from({ length: 144 }, (_, i) => String(i + 1)), 12, 12);
assert.equal((matrix12.match(/<mtd>/g) || []).length, 144);
assert.match(equation('determinant', ['1', '2', '3', '4'], 2, 2), /<mo>\|<\/mo><mtable>/);
assert.match(equation('piecewise', ['x', 'x>0', '-x', 'x<0'], 2, 2), /<mo>\{<\/mo><mtable>/);

assert.match(equation('fraction', ['a', 'b']), /<mfrac>/);
assert.match(equation('binomial', ['n', 'k']), /linethickness="0"/);
assert.match(equation('subsup', ['x', 'i', '2']), /<msubsup>/);
assert.match(equation('double_integral', ['f(x,y)', 'A', '']), /∬/);
assert.match(equation('triple_integral', ['f(x,y,z)', 'V', '']), /∭/);
assert.match(equation('product', ['i', 'i=1', 'n']), /∏/);
assert.match(equation('partial', ['f(x,y)', 'x']), /∂/);
assert.match(equation('vector', ['AB']), /<mover accent="true">/);
assert.match(equation('chemistry', ['H2SO4+', '']), /<msub><mtext>O<\/mtext><mn>4<\/mn><\/msub>/);
assert.match(equation('reaction', ['H2,O2', 'H2O', '→']), /<mo>→<\/mo>/);
assert.match(equation('isotope', ['C', '17', '12']), /<mprescripts\/><mn>12<\/mn><mn>17<\/mn>/);
assert.equal(equation('fraction', ['a', '']), '');
assert.equal(equation('matrix', [], 3, 3), '');
assert.doesNotMatch(equation('symbol', ['<script>']), /<script>/);

const spreadsheet = fs.readFileSync(path.join(__dirname, '../public/assets/js/cbt/spreadsheet.js'), 'utf8');
vm.runInContext(spreadsheet, context);
function omml(name, children = [], text = '') {
  return {
    nodeType: 1, localName: name, childNodes: children, textContent: text,
    getAttribute: () => null, getAttributeNS: () => null,
    getElementsByTagNameNS: (_, wanted) => children.flatMap(child => [
      ...(child.localName === wanted ? [child] : []),
      ...child.getElementsByTagNameNS('*', wanted)
    ])
  };
}
const textRun = value => omml('r', [omml('t', [], String(value))]);
const excelMatrix = size => omml('oMath', [omml('m', Array.from({ length: size }, (_, row) =>
  omml('mr', Array.from({ length: size }, (_, column) => omml('e', [textRun(row * size + column + 1)])))))]);
const imported3 = context.officeMathToMathMl(excelMatrix(3));
const imported5 = context.officeMathToMathMl(excelMatrix(5));
assert.equal((imported3.match(/<mtd>/g) || []).length, 9);
assert.equal((imported5.match(/<mtd>/g) || []).length, 25);
assert.match(imported5, /display="inline"/);
const prescript = omml('oMath', [omml('sPre', [omml('e', [textRun('C')]), omml('sub', [textRun('12')]), omml('sup', [textRun('17')])])]);
assert.match(context.officeMathToMathMl(prescript), /<mmultiscripts>/);

const inserted = [];
let caretMarker = null;
const range = {
  commonAncestorContainer: { isConnected: true },
  cloneRange() { return this; },
  deleteContents() {},
  createContextualFragment() { return { lastChild: { parentElement: null } }; },
  insertNode(node) { inserted.push(node); },
  setStartAfter() {},
  setStart(node, offset) { caretMarker = node; assert.equal(offset, 1); },
  collapse() {}
};
const selection = { rangeCount: 1, getRangeAt: () => range, toString: () => '', removeAllRanges() {}, addRange() {} };
const editor = {
  innerHTML: 'H<sub>2</sub>\u200BO',
  focus() {}, contains: () => true, dispatchEvent() {}
};
document.getElementById = id => id === 'inPertanyaan' ? editor : modal;
document.createTextNode = text => ({ textContent: text, length: text.length });
context.window = { getSelection: () => selection };
context.Event = function Event() {};
context.wrapQuestionContent('inPertanyaan', '<sub>', '</sub>', '2');
assert.equal(caretMarker.textContent, '\u200B');
assert.equal(inserted.at(-1), caretMarker);
assert.equal(context.questionEditorValue('inPertanyaan'), 'H<sub>2</sub>O');
context.wrapQuestionContent('inPertanyaan', '<sup>', '</sup>', '2');
assert.equal(inserted.at(-1).textContent, '\u200B');
editor.innerHTML = 'x<sup>2</sup>&#8203; + H<sub>2</sub>&ZeroWidthSpace;O';
assert.equal(context.questionEditorValue('inPertanyaan'), 'x<sup>2</sup> + H<sub>2</sub>O');

console.log('Equation editor, Excel conversion, and caret reset: 30 checks passed.');
