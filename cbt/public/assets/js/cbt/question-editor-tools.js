const questionEditorIds=['inPertanyaan','inOpsiA','inOpsiB','inOpsiC','inOpsiD','inOpsiE'];
let questionEquationTarget='';
let questionEquationRange=null;

function questionTextIsArabic(value){return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/u.test(String(value||''));}
function updateQuestionEditorDirection(field){if(!field)return;const rtl=questionTextIsArabic(field.textContent);field.dir=rtl?'rtl':'ltr';field.classList.toggle('question-editor-rtl',rtl);}
function questionEditorValue(fieldId){const field=document.getElementById(fieldId);return field?field.innerHTML.replace(/\u200B|&#(?:8203|x200b);|&ZeroWidthSpace;/gi,'').trim():'';}
function setQuestionEditorValue(fieldId,value){const field=document.getElementById(fieldId);if(field){field.innerHTML=String(value||'');updateQuestionEditorDirection(field);}}
function clearQuestionEditors(){questionEditorIds.forEach(id=>setQuestionEditorValue(id,''));}
questionEditorIds.forEach(id=>{const field=document.getElementById(id);if(field){field.addEventListener('input',()=>updateQuestionEditorDirection(field));field.addEventListener('paste',()=>setTimeout(()=>updateQuestionEditorDirection(field)));updateQuestionEditorDirection(field);}});
function escapeQuestionMathText(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'})[char]);}
function questionMathTokens(value){return (String(value||'').match(/[0-9]+(?:[.,][0-9]+)?|[A-Za-z\u00C0-\uFFFF]+|\s+|./gu)||[]).map(part=>/^\s+$/u.test(part)?'<mspace width="0.25em"></mspace>':(/^[0-9]/u.test(part)?`<mn>${escapeQuestionMathText(part)}</mn>`:(/^[A-Za-z\u00C0-\uFFFF]/u.test(part)?`<mi>${escapeQuestionMathText(part)}</mi>`:`<mo>${escapeQuestionMathText(part)}</mo>`))).join('');}

function rememberQuestionEditorSelection(fieldId){const field=document.getElementById(fieldId),selection=window.getSelection();questionEquationTarget=fieldId;questionEquationRange=null;if(field&&selection?.rangeCount){const range=selection.getRangeAt(0);if(field.contains(range.commonAncestorContainer))questionEquationRange=range.cloneRange();}}
function insertQuestionHtml(fieldId,html,plainAfter=false){const field=document.getElementById(fieldId);if(!field)return;field.focus();let range=questionEquationTarget===fieldId?questionEquationRange:null;if(!range||!range.commonAncestorContainer?.isConnected||!field.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(field);range.collapse(false);}range.deleteContents();const fragment=range.createContextualFragment(html),last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);if(plainAfter){const scriptParent=last.parentElement?.closest('sub,sup');if(scriptParent&&field.contains(scriptParent)){range.setStartAfter(scriptParent);range.collapse(true);}const marker=document.createTextNode('\u200B');range.insertNode(marker);range.setStart(marker,marker.length);range.collapse(true);}const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}questionEquationTarget=fieldId;questionEquationRange=range.cloneRange();field.dispatchEvent(new Event('input',{bubbles:true}));}
function wrapQuestionContent(fieldId,before,after,placeholder=''){const tag=before.includes('sub')?'sub':'sup',field=document.getElementById(fieldId);if(!field)return;rememberQuestionEditorSelection(fieldId);const selected=window.getSelection()?.toString()||placeholder||'2';insertQuestionHtml(fieldId,`<${tag}>${escapeQuestionMathText(selected)}</${tag}>`,true);}
function insertQuestionSymbol(fieldId,symbol){rememberQuestionEditorSelection(fieldId);insertQuestionHtml(fieldId,escapeQuestionMathText(symbol));}

const questionEquationTypes=[['fraction','Pecahan'],['mixed','Bilangan campuran'],['power','Pangkat'],['subscript','Subscript'],['subsup','Subscript + pangkat'],['root','Akar'],['binomial','Kombinasi/binomial'],['integral','Integral'],['double_integral','Integral ganda'],['triple_integral','Integral rangkap tiga'],['sum','Sigma'],['product','Pi/perkalian'],['limit','Limit'],['logarithm','Logaritma'],['derivative','Turunan'],['partial','Turunan parsial'],['vector','Vektor'],['overbar','Garis atas'],['absolute','Nilai mutlak'],['matrix','Matriks'],['determinant','Determinan'],['piecewise','Fungsi bertahap/sistem'],['chemistry','Rumus kimia'],['reaction','Reaksi kimia'],['isotope','Notasi isotop'],['symbol','Simbol sains']];
const questionEquationFields={fraction:[['Pembilang','a'],['Penyebut','b']],mixed:[['Bilangan bulat','2'],['Pembilang','1'],['Penyebut','3']],power:[['Nilai dasar','x'],['Pangkat','2']],subscript:[['Nilai dasar','x'],['Indeks','1']],subsup:[['Nilai dasar','x'],['Subscript','i'],['Pangkat','2']],root:[['Isi akar','x'],['Pangkat akar (opsional)','']],binomial:[['Bagian atas','n'],['Bagian bawah','k']],integral:[['Ekspresi','f(x) dx'],['Batas bawah','a'],['Batas atas','b']],double_integral:[['Ekspresi','f(x,y) dA'],['Batas bawah','A'],['Batas atas (opsional)','']],triple_integral:[['Ekspresi','f(x,y,z) dV'],['Batas bawah','V'],['Batas atas (opsional)','']],sum:[['Ekspresi','i'],['Batas bawah','i=1'],['Batas atas','n']],product:[['Ekspresi','i'],['Batas bawah','i=1'],['Batas atas','n']],limit:[['Ekspresi','f(x)'],['Variabel','x'],['Menuju','0']],logarithm:[['Basis','2'],['Argumen','x']],derivative:[['Fungsi','f(x)'],['Variabel','x']],partial:[['Fungsi','f(x,y)'],['Variabel','x']],vector:[['Vektor','AB']],overbar:[['Ekspresi','x']],absolute:[['Ekspresi','x']],chemistry:[['Rumus kimia','H2SO4'],['Muatan (opsional)','+']],reaction:[['Pereaksi (pisahkan koma)','H2,O2'],['Produk (pisahkan koma)','H2O'],['Panah: → atau ⇌','→']],isotope:[['Simbol unsur','C'],['Nomor massa (atas kiri)','17'],['Nomor atom (bawah kiri)','12']],symbol:[['Simbol (mis. α, Δ, μ, Ω, ∞)','α']]};
function ensureQuestionEquationModal(){let modal=document.getElementById('modalQuestionEquation');if(modal)return modal;modal=document.createElement('div');modal.id='modalQuestionEquation';modal.className='modal';modal.innerHTML=`<div class="modal-content question-equation-dialog"><div class="modal-header"><div><h3>Insert Equation</h3><p>Pilih bentuk equation secara visual tanpa LaTeX.</p></div><button type="button" class="btn-close" aria-label="Tutup">&times;</button></div><label class="ui-label">Bentuk equation<select id="questionEquationType" class="ui-control">${questionEquationTypes.map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><div id="questionEquationFields" class="question-equation-fields"></div><div id="questionEquationPreview" class="question-equation-preview"></div><div class="modal-actions"><button type="button" class="ui-button btn btn-secondary" data-action="cancel">Batal</button><button type="button" class="ui-button btn btn-primary" data-action="insert">Insert Equation</button></div></div>`;document.body.appendChild(modal);modal.querySelector('.btn-close').onclick=modal.querySelector('[data-action="cancel"]').onclick=()=>modal.classList.remove('show');modal.querySelector('#questionEquationType').onchange=renderQuestionEquationFields;modal.querySelector('[data-action="insert"]').onclick=()=>{const math=buildQuestionMathMl();if(!math)return showCustomAlert('Equation Belum Lengkap','Isi nilai equation terlebih dahulu.','warning');insertQuestionHtml(questionEquationTarget,math,true);modal.classList.remove('show');};return modal;}
function renderQuestionMatrixFields(rows=3,cols=3){
 const fields=document.getElementById('questionEquationFields');if(!fields)return;
 const old={};fields.querySelectorAll('[data-matrix-cell]').forEach(input=>{old[input.dataset.matrixCell]=input.value;});
 const type=document.getElementById('questionEquationType')?.value;
 const piecewise=type==='piecewise';if(piecewise)cols=2;
 rows=Math.min(20,Math.max(1,Number(rows)||3));cols=Math.min(20,Math.max(1,Number(cols)||3));
 fields.innerHTML=`<div class="question-matrix-settings"><label class="ui-label">Baris<input id="questionMatrixRows" class="ui-control" type="number" min="1" max="20" value="${rows}"></label>${piecewise?'':`<label class="ui-label">Kolom<input id="questionMatrixCols" class="ui-control" type="number" min="1" max="20" value="${cols}"></label>`}</div><div class="question-matrix-scroll"><div class="question-matrix-grid" style="grid-template-columns:repeat(${cols},minmax(64px,1fr))">${Array.from({length:rows},(_,r)=>Array.from({length:cols},(_,c)=>`<input class="ui-control" data-matrix-cell="${r}-${c}" aria-label="Baris ${r+1} kolom ${c+1}" placeholder="${piecewise?(c?'syarat':'nilai'):`${r+1},${c+1}`}">`).join('')).join('')}</div></div>`;
 fields.querySelectorAll('[data-matrix-cell]').forEach(input=>{input.value=old[input.dataset.matrixCell]||'';input.addEventListener('input',renderQuestionEquationPreview);});
 fields.querySelectorAll('#questionMatrixRows,#questionMatrixCols').forEach(input=>input.addEventListener('change',()=>renderQuestionMatrixFields(fields.querySelector('#questionMatrixRows')?.value,fields.querySelector('#questionMatrixCols')?.value||2)));
 renderQuestionEquationPreview();
}
function renderQuestionEquationFields(){const modal=ensureQuestionEquationModal(),type=modal.querySelector('#questionEquationType').value,fields=modal.querySelector('#questionEquationFields');if(['matrix','determinant','piecewise'].includes(type)){fields.innerHTML='';renderQuestionMatrixFields(type==='piecewise'?2:3,type==='piecewise'?2:3);return;}const definitions=questionEquationFields[type]||questionEquationFields.fraction;fields.innerHTML=definitions.map(([label,placeholder],index)=>`<label class="ui-label">${label}<input class="ui-control" data-equation-value="${index}" placeholder="${placeholder}"></label>`).join('');fields.querySelectorAll('input').forEach(input=>input.addEventListener('input',renderQuestionEquationPreview));renderQuestionEquationPreview();fields.querySelector('input')?.focus();}
function questionChemistryMathMl(formula,explicitCharge=''){
 let source=String(formula||'').trim(),charge=String(explicitCharge||'').trim();
 if(!charge&&/[+-]$/.test(source)){charge=source.slice(-1);source=source.slice(0,-1);const single=source.match(/^([A-Z][a-z]?)(\d+)$/);if(single){source=single[1];charge=single[2]+charge;}}
 if(!source||!/^[A-Za-z0-9()[\]·.\s]+$/u.test(source)||charge&&!/^\d*[+-]$/.test(charge))return'';
 const parts=source.match(/([A-Z][a-z]?)(\d*)|([)\]])(\d+)|(\d+)|\s+|./gu)||[];
 const body=parts.map(part=>{const element=part.match(/^([A-Z][a-z]?)(\d*)$/);if(element){const base=`<mtext>${escapeQuestionMathText(element[1])}</mtext>`;return element[2]?`<msub>${base}<mn>${element[2]}</mn></msub>`:base;}const group=part.match(/^([)\]])(\d+)$/);if(group)return `<msub><mo>${escapeQuestionMathText(group[1])}</mo><mn>${group[2]}</mn></msub>`;if(/^\d+$/.test(part))return `<mn>${part}</mn>`;if(/^\s+$/.test(part))return '<mspace width="0.25em"></mspace>';return `<mo>${escapeQuestionMathText(part)}</mo>`;}).join('');
 const molecule=`<mrow>${body}</mrow>`;
 if(!charge)return molecule;
 const chargeBody=charge.length===1?`<mo>${charge}</mo>`:`<mrow><mn>${charge.slice(0,-1)}</mn><mo>${charge.slice(-1)}</mo></mrow>`;
 return `<msup>${molecule}${chargeBody}</msup>`;
}
function buildQuestionMathMl(){
 const modal=document.getElementById('modalQuestionEquation');if(!modal)return'';
 const type=modal.querySelector('#questionEquationType').value;
 const token=value=>`<mrow>${questionMathTokens(value)}</mrow>`;
 let body='';
 if(['matrix','determinant','piecewise'].includes(type)){
  const rows=Math.min(20,Math.max(1,Number(modal.querySelector('#questionMatrixRows')?.value)||3));
  const cols=type==='piecewise'?2:Math.min(20,Math.max(1,Number(modal.querySelector('#questionMatrixCols')?.value)||3));
  const cells=Array.from(modal.querySelectorAll('[data-matrix-cell]'));
  if(cells.length!==rows*cols||!cells.some(input=>input.value.trim()))return'';
  const table=`<mtable>${Array.from({length:rows},(_,r)=>`<mtr>${Array.from({length:cols},(_,c)=>`<mtd>${token(cells[r*cols+c].value.trim())}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
  body=type==='determinant'?`<mrow><mo>|</mo>${table}<mo>|</mo></mrow>`:type==='piecewise'?`<mrow><mo>{</mo>${table}</mrow>`:`<mrow><mo>[</mo>${table}<mo>]</mo></mrow>`;
 }else{
  const values=Array.from(modal.querySelectorAll('[data-equation-value]')).map(input=>input.value.trim());
  if(!values[0])return'';
  if(type==='fraction'||type==='binomial'){
   if(!values[1])return'';
   const fraction=`<mfrac${type==='binomial'?' linethickness="0"':''}>${token(values[0])}${token(values[1])}</mfrac>`;
   body=type==='binomial'?`<mrow><mo>(</mo>${fraction}<mo>)</mo></mrow>`:fraction;
  }else if(type==='mixed'){
   if(!values[1]||!values[2])return'';
   body=`<mrow>${token(values[0])}<mfrac>${token(values[1])}${token(values[2])}</mfrac></mrow>`;
  }else if(type==='power'||type==='subscript'){
   if(!values[1])return'';
   body=`<${type==='power'?'msup':'msub'}>${token(values[0])}${token(values[1])}</${type==='power'?'msup':'msub'}>`;
  }else if(type==='subsup'){
   if(!values[1]||!values[2])return'';
   body=`<msubsup>${token(values[0])}${token(values[1])}${token(values[2])}</msubsup>`;
  }else if(type==='root')body=values[1]?`<mroot>${token(values[0])}${token(values[1])}</mroot>`:`<msqrt>${token(values[0])}</msqrt>`;
  else if(['integral','double_integral','triple_integral','sum','product'].includes(type)){
   const symbol={integral:'∫',double_integral:'∬',triple_integral:'∭',sum:'∑',product:'∏'}[type];
   const base=`<mo>${symbol}</mo>`;
   const limits=values[1]&&values[2]?`<munderover>${base}${token(values[1])}${token(values[2])}</munderover>`:values[1]?`<munder>${base}${token(values[1])}</munder>`:base;
   body=`<mrow>${limits}${token(values[0])}</mrow>`;
  }else if(type==='limit'){
   if(!values[1]||!values[2])return'';
   body=`<mrow><munder><mi>lim</mi><mrow>${token(values[1])}<mo>→</mo>${token(values[2])}</mrow></munder>${token(values[0])}</mrow>`;
  }else if(type==='logarithm'){
   if(!values[1])return'';
   body=`<mrow><msub><mi>log</mi>${token(values[0])}</msub><mo>(</mo>${token(values[1])}<mo>)</mo></mrow>`;
  }else if(type==='derivative'||type==='partial'){
   if(!values[1])return'';
   const symbol=type==='partial'?'∂':'d';
   body=`<mrow><mfrac><mo>${symbol}</mo><mrow><mo>${symbol}</mo>${token(values[1])}</mrow></mfrac>${token(values[0])}</mrow>`;
  }else if(type==='vector'||type==='overbar')body=`<mover accent="true">${token(values[0])}<mo>${type==='vector'?'→':'¯'}</mo></mover>`;
  else if(type==='absolute')body=`<mrow><mo>|</mo>${token(values[0])}<mo>|</mo></mrow>`;
  else if(type==='chemistry')body=questionChemistryMathMl(values[0],values[1]);
  else if(type==='reaction'){
   if(!values[1])return'';
   const side=value=>value.split(',').map(part=>questionChemistryMathMl(part.trim())).filter(Boolean);
   const left=side(values[0]),right=side(values[1]);if(!left.length||!right.length||left.length!==values[0].split(',').length||right.length!==values[1].split(',').length)return'';
   const join=parts=>parts.join('<mo>+</mo>');
   body=`<mrow>${join(left)}<mo>${['⇌','⇄'].includes(values[2])?values[2]:'→'}</mo>${join(right)}</mrow>`;
  }else if(type==='isotope'){
   if(!/^[A-Z][a-z]?$/.test(values[0])||!/^[0-9]+$/.test(values[1])||!/^[0-9]+$/.test(values[2]))return'';
   body=`<mmultiscripts><mtext>${escapeQuestionMathText(values[0])}</mtext><mprescripts/><mn>${values[2]}</mn><mn>${values[1]}</mn></mmultiscripts>`;
  }else if(type==='symbol')body=questionMathTokens(values[0]);
 }
 return body?`<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline">${body}</math>`:'';
}
function renderQuestionEquationPreview(){const preview=document.getElementById('questionEquationPreview');if(!preview)return;preview.innerHTML=buildQuestionMathMl()||'<span>Preview equation</span>';typesetQuestionMath(preview);}
function insertQuestionEquation(fieldId){rememberQuestionEditorSelection(fieldId);const modal=ensureQuestionEquationModal();modal.classList.add('show');renderQuestionEquationFields();}
function handleQuestionContentImage(input,fieldId){const file=input.files?.[0];if(!file)return;if(file.size>20*1024*1024){input.value='';return showCustomAlert('File Terlalu Besar','Maksimal ukuran sumber gambar adalah 20 MB.','warning');}rememberQuestionEditorSelection(fieldId);const reader=new FileReader();reader.onload=async event=>{try{const image=await optimizeQuestionImageDataUrl(questionImageSourceDataUrl(file,event.target.result));insertQuestionHtml(fieldId,`<img src="${image}" alt="Gambar soal">`,true);}catch(error){showCustomAlert('Gambar Gagal Diproses',error.message,'error');}input.value='';};reader.onerror=()=>{input.value='';showCustomAlert('Gambar Gagal Dibaca','File gambar tidak dapat dibaca.','error');};reader.readAsDataURL(file);}

function safeQuestionPreviewHtml(value){
 const template=document.createElement('template');template.innerHTML=String(value||'');
 const mathTags=new Set(['MATH','MROW','MI','MN','MO','MTEXT','MSPACE','MFRAC','MSQRT','MROOT','MSUB','MSUP','MSUBSUP','MUNDER','MOVER','MUNDEROVER','MMULTISCRIPTS','MPRESCRIPTS','NONE','MTABLE','MTR','MTD','MENCLOSE','MPADDED','MPHANTOM']),allowed=new Set(['BR','SUP','SUB','B','STRONG','I','EM','U','P','DIV','SPAN','IMG',...mathTags]);
 Array.from(template.content.querySelectorAll('*')).forEach(element=>{const tag=element.tagName.toUpperCase();if(!allowed.has(tag)){element.replaceWith(document.createTextNode(element.textContent||''));return;}const src=tag==='IMG'?element.getAttribute('src')||'':'',safeAttributes={};if(mathTags.has(tag))['display','xmlns','width','accent','accentunder','notation','linethickness','bevelled'].forEach(name=>{if(element.hasAttribute(name))safeAttributes[name]=element.getAttribute(name);});Array.from(element.attributes).forEach(attribute=>element.removeAttribute(attribute.name));Object.entries(safeAttributes).forEach(([name,content])=>element.setAttribute(name,content));const safeImage=/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(src)||/^(?![/\\]{2})(?:\/?[A-Za-z0-9_-])[A-Za-z0-9_./?=&%+#-]*$/.test(src);if(tag==='IMG'&&safeImage){element.setAttribute('src',src);element.setAttribute('alt','Gambar soal');}else if(tag==='IMG')element.remove();});return template.innerHTML;
}

// Toolbar clicks must not move focus away from a selected digit in the editor.
// Otherwise clicking x₂/x² can lose the selection before it is formatted.
document.querySelectorAll('.question-format-toolbar button').forEach(button=>{
 button.addEventListener('mousedown',event=>event.preventDefault());
});
