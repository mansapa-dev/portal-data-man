import { useEffect, useRef, useState } from 'react';

const arabic=/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff\ufb50-\ufdff\ufe70-\ufeff]/u;
const esc=(value:string)=>value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]!));
const tokens=(value:string)=>(value.match(/[0-9]+(?:[.,][0-9]+)?|[A-Za-z\u00c0-\uffff]+|\s+|./gu)||[]).map(part=>/^\s+$/u.test(part)?'<mspace width="0.25em"></mspace>':/^[0-9]/u.test(part)?`<mn>${esc(part)}</mn>`:/^[A-Za-z\u00c0-\uffff]/u.test(part)?`<mi>${esc(part)}</mi>`:`<mo>${esc(part)}</mo>`).join('');
const row=(value:string)=>`<mrow>${tokens(value)}</mrow>`;
const math=(body:string)=>`<math xmlns="http://www.w3.org/1998/Math/MathML" display="inline">${body}</math>`;
const typeset=(element:HTMLElement|null)=>{const engine=(window as unknown as {MathJax?:{typesetPromise?:(elements?:HTMLElement[])=>Promise<void>}}).MathJax;if(element)void engine?.typesetPromise?.([element]);};
type EquationType='fraction'|'power'|'subscript'|'subsup'|'root'|'integral'|'sum'|'limit'|'absolute'|'vector'|'chemistry'|'isotope'|'matrix';

function buildEquation(type:EquationType,values:string[]){
  if(!values[0]?.trim())return '';
  if(type==='fraction')return values[1]?.trim()?math(`<mfrac>${row(values[0])}${row(values[1])}</mfrac>`):'';
  if(type==='power')return values[1]?.trim()?math(`<msup>${row(values[0])}${row(values[1])}</msup>`):'';
  if(type==='subscript')return values[1]?.trim()?math(`<msub>${row(values[0])}${row(values[1])}</msub>`):'';
  if(type==='subsup')return values[1]?.trim()&&values[2]?.trim()?math(`<msubsup>${row(values[0])}${row(values[1])}${row(values[2])}</msubsup>`):'';
  if(type==='root')return math(values[1]?.trim()?`<mroot>${row(values[0])}${row(values[1])}</mroot>`:`<msqrt>${row(values[0])}</msqrt>`);
  if(type==='absolute')return math(`<mrow><mo>|</mo>${row(values[0])}<mo>|</mo></mrow>`);
  if(type==='vector')return math(`<mover accent="true">${row(values[0])}<mo>→</mo></mover>`);
  if(type==='integral'||type==='sum'){
    const symbol=type==='integral'?'∫':'∑',operator=values[1]?.trim()&&values[2]?.trim()?`<munderover><mo>${symbol}</mo>${row(values[1])}${row(values[2])}</munderover>`:`<mo>${symbol}</mo>`;
    return math(`<mrow>${operator}${row(values[0])}</mrow>`);
  }
  if(type==='limit')return values[1]?.trim()&&values[2]?.trim()?math(`<mrow><munder><mi>lim</mi><mrow>${row(values[1])}<mo>→</mo>${row(values[2])}</mrow></munder>${row(values[0])}</mrow>`):'';
  if(type==='isotope')return /^[A-Z][a-z]?$/.test(values[0])&&/^\d+$/.test(values[1]||'')&&/^\d+$/.test(values[2]||'')?math(`<mmultiscripts><mtext>${values[0]}</mtext><mprescripts/><mn>${values[2]}</mn><mn>${values[1]}</mn></mmultiscripts>`):'';
  if(type==='matrix'){
    const rows=values[0].split(/\r?\n/).map(line=>line.split(',').map(x=>x.trim())).filter(cells=>cells.some(Boolean));
    if(!rows.length)return '';
    return math(`<mrow><mo>[</mo><mtable>${rows.map(cells=>`<mtr>${cells.map(cell=>`<mtd>${row(cell)}</mtd>`).join('')}</mtr>`).join('')}</mtable><mo>]</mo></mrow>`);
  }
  const formula=values[0].trim(),charge=values[1]?.trim()||'';
  if(!/^[A-Za-z0-9()[\]·.\s]+$/u.test(formula)||charge&&!/^\d*[+-]$/.test(charge))return '';
  const parts=formula.match(/([A-Z][a-z]?)(\d*)|([)\]])(\d+)|(\d+)|\s+|./gu)||[];
  const body=parts.map(part=>{const element=part.match(/^([A-Z][a-z]?)(\d*)$/);if(element){const base=`<mtext>${element[1]}</mtext>`;return element[2]?`<msub>${base}<mn>${element[2]}</mn></msub>`:base;}const group=part.match(/^([)\]])(\d+)$/);return group?`<msub><mo>${group[1]}</mo><mn>${group[2]}</mn></msub>`:/^\d+$/.test(part)?`<mn>${part}</mn>`:/^\s+$/.test(part)?'<mspace width="0.25em"></mspace>':`<mo>${esc(part)}</mo>`;}).join('');
  return math(charge?`<msup><mrow>${body}</mrow>${row(charge)}</msup>`:`<mrow>${body}</mrow>`);
}

export function RichContentEditor({label,value,onChange,onUpload,required=false}:{label:string;value:string;onChange:(value:string)=>void;onUpload:(file:File)=>Promise<string>;required?:boolean}){
  const editor=useRef<HTMLDivElement>(null),equationPreview=useRef<HTMLDivElement>(null),selection=useRef<Range|null>(null),file=useRef<HTMLInputElement>(null);
  const [equation,setEquation]=useState<EquationType|null>(null),[values,setValues]=useState(['','']);
  useEffect(()=>{if(editor.current&&editor.current.innerHTML!==value)editor.current.innerHTML=value;},[value]);
  useEffect(()=>typeset(equationPreview.current),[equation,values]);
  const remember=()=>{const selected=window.getSelection();selection.current=selected?.rangeCount&&editor.current?.contains(selected.getRangeAt(0).commonAncestorContainer)?selected.getRangeAt(0).cloneRange():null;};
  const sync=()=>{if(!editor.current)return;editor.current.dir=arabic.test(editor.current.textContent||'')?'rtl':'ltr';onChange(editor.current.innerHTML.replace(/\u200b/g,'').trim());};
  const insert=(html:string)=>{const target=editor.current;if(!target)return;target.focus();let range=selection.current;if(!range||!target.contains(range.commonAncestorContainer)){range=document.createRange();range.selectNodeContents(target);range.collapse(false);}range.deleteContents();const fragment=range.createContextualFragment(html),last=fragment.lastChild;range.insertNode(fragment);if(last){range.setStartAfter(last);range.collapse(true);const selected=window.getSelection();selected?.removeAllRanges();selected?.addRange(range);}selection.current=range.cloneRange();sync();};
  const wrap=(tag:'sup'|'sub')=>{remember();insert(`<${tag}>${esc(window.getSelection()?.toString()||'2')}</${tag}>`);};
  const upload=async(selected:File)=>{remember();insert(`<img src="${await onUpload(selected)}" alt="Gambar soal">`);};
  const names:Record<EquationType,string[]>= {fraction:['Pembilang','Penyebut'],power:['Nilai dasar','Pangkat'],subscript:['Nilai dasar','Indeks'],subsup:['Nilai dasar','Indeks','Pangkat'],root:['Isi akar','Pangkat akar (opsional)'],integral:['Ekspresi','Batas bawah','Batas atas'],sum:['Ekspresi','Batas bawah','Batas atas'],limit:['Ekspresi','Variabel','Menuju'],absolute:['Ekspresi'],vector:['Vektor'],chemistry:['Rumus kimia','Muatan (opsional)'],isotope:['Simbol unsur','Nomor massa','Nomor atom'],matrix:['Matriks','']};
  return <fieldset style={{margin:'10px 0',border:'1px solid #d9e2ec',borderRadius:8}}><legend>{label}</legend>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:7}} onMouseDown={event=>event.preventDefault()}><button type="button" onClick={()=>wrap('sup')}>x<sup>2</sup></button><button type="button" onClick={()=>wrap('sub')}>x<sub>2</sub></button><button type="button" onClick={()=>{remember();setValues(['','']);setEquation('fraction');}}>Equation</button><button type="button" onClick={()=>insert('±')}>±</button><button type="button" onClick={()=>insert('°')}>°</button><button type="button" onClick={()=>file.current?.click()}>Gambar</button><input ref={file} hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={event=>{const selected=event.target.files?.[0];if(selected)void upload(selected);event.target.value='';}}/></div>
    <div ref={editor} contentEditable role="textbox" aria-required={required} aria-multiline="true" dir="auto" suppressContentEditableWarning onInput={sync} onKeyUp={remember} onMouseUp={remember} onFocus={remember} style={{minHeight:label==='Pertanyaan'?110:60,padding:10,border:'1px solid #bcccdc',borderRadius:6,lineHeight:1.75,fontFamily:'"Noto Naskh Arabic","Noto Sans Arabic","Segoe UI",sans-serif',unicodeBidi:'plaintext',textAlign:'start',overflowWrap:'anywhere'}} />
    {equation&&<div role="dialog" aria-label="Insert Equation" style={{padding:12,marginTop:8,background:'#f0f4f8',borderRadius:8}}><label>Bentuk <select value={equation} onChange={e=>{setEquation(e.target.value as EquationType);setValues(['','','']);}}>{[['fraction','Pecahan'],['power','Pangkat'],['subscript','Subscript'],['subsup','Indeks + pangkat'],['root','Akar'],['integral','Integral'],['sum','Sigma'],['limit','Limit'],['absolute','Nilai mutlak'],['vector','Vektor'],['chemistry','Rumus kimia'],['isotope','Notasi isotop'],['matrix','Matriks']].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>{equation==='matrix'?<textarea rows={3} placeholder={'1, 2\n3, 4'} value={values[0]} onChange={e=>setValues([e.target.value,'',''])} style={{display:'block',width:'100%',boxSizing:'border-box',marginTop:8}}/>:names[equation].filter(Boolean).map((name,index)=><label key={name} style={{display:'block',marginTop:8}}>{name}<input value={values[index]||''} onChange={e=>setValues(current=>{const next=[...current];next[index]=e.target.value;return next;})}/></label>)}<div style={{marginTop:10}}><button type="button" onClick={()=>{const html=buildEquation(equation,values);if(html){insert(html);setEquation(null);}}}>Sisipkan</button> <button type="button" onClick={()=>setEquation(null)}>Batal</button></div><div ref={equationPreview} style={{marginTop:8,overflowX:'auto'}} dangerouslySetInnerHTML={{__html:buildEquation(equation,values)}}/></div>}
  </fieldset>;
}
