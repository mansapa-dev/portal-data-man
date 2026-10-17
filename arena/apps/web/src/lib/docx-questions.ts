import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { convertOmml } from './xlsx-images';
import { defaultReportIdentity } from './print-format';

const wordNs = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const mathNs = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const relNs = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const imageTypes: Record<string,string> = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp' };
export const wordQuestionColumns = ['exam_id','question_type','question_text','option_a','option_b','option_c','option_d','option_e','correct_answer','points'];

function escapeXml(value:string){return value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]!));}
function children(element:Element,name:string){return Array.from(element.children).filter(child=>child.localName===name);}
function packagePath(target:string){const parts=(target.startsWith('/')?target.slice(1):`word/${target}`).split('/'),path:string[]=[];for(const part of parts){if(part==='..')path.pop();else if(part&&part!=='.')path.push(part);}return path.join('/');}
function base64(bytes:Uint8Array){let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));return btoa(binary);}
function canonicalField(value:string){const key=value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');const aliases:Record<string,string>={id_ujian:'exam_id',ujian_id:'exam_id',jenis_soal:'question_type',tipe_soal:'question_type',pertanyaan:'question_text',soal:'question_text',teks_soal:'question_text',kunci:'correct_answer',kunci_jawaban:'correct_answer',jawaban_benar:'correct_answer',bobot:'points',poin:'points'};return aliases[key]??key.replace(/^(?:opsi|pilihan)_([a-e])$/,'option_$1');}

export function parseWordQuestions(buffer:ArrayBuffer):unknown[][]{
 const files=unzipSync(new Uint8Array(buffer)),source=files['word/document.xml'];
 if(!source)throw new Error('File Word tidak memiliki word/document.xml. Simpan sebagai DOCX.');
 const document=new DOMParser().parseFromString(strFromU8(source),'application/xml');
 if(document.getElementsByTagName('parsererror').length)throw new Error('Struktur DOCX tidak dapat dibaca.');
 const relationships=new Map<string,string>();
 const relSource=files['word/_rels/document.xml.rels'];
 if(relSource){const relDoc=new DOMParser().parseFromString(strFromU8(relSource),'application/xml');for(const relation of Array.from(relDoc.getElementsByTagNameNS('*','Relationship'))){const id=relation.getAttribute('Id'),target=relation.getAttribute('Target');if(id&&target&&relation.getAttribute('TargetMode')!=='External')relationships.set(id,packagePath(target));}}
 const image=(id:string|null)=>{if(!id)return '';const path=relationships.get(id);if(!path)return '';const data=files[path];if(!data)return '';const extension=path.split('.').pop()?.toLowerCase()??'',mime=imageTypes[extension];if(!mime)throw new Error(`Gambar Word ${extension||'tanpa format'} belum didukung. Gunakan PNG, JPEG, WebP, atau GIF.`);if(data.length>2*1024*1024)throw new Error('Gambar Word maksimal 2 MB per gambar.');return `<img src="data:${mime};base64,${base64(data)}" alt="Gambar dari Word">`;};
 const read=(element:Element):string=>{
  if(element.namespaceURI===mathNs&&element.localName==='oMath')return `<math xmlns="http://www.w3.org/1998/Math/MathML">${convertOmml(element)}</math>`;
  if(element.namespaceURI===wordNs&&element.localName==='t')return escapeXml(element.textContent??'');
  if(element.namespaceURI===wordNs&&element.localName==='tab')return ' ';
  if(element.namespaceURI===wordNs&&element.localName==='br')return '<br>';
  if(element.localName==='blip')return image(element.getAttributeNS(relNs,'embed')??element.getAttribute('r:embed'));
  if(element.localName==='imagedata')return image(element.getAttributeNS(relNs,'id')??element.getAttribute('r:id'));
  if(element.namespaceURI===wordNs&&element.localName==='r'){
   const content=Array.from(element.children).filter(child=>child.localName!=='rPr').map(read).join('');
   const alignment=children(element,'rPr')[0]?.getElementsByTagNameNS(wordNs,'vertAlign')[0]?.getAttributeNS(wordNs,'val');
   return alignment==='superscript'?`<sup>${content}</sup>`:alignment==='subscript'?`<sub>${content}</sub>`:content;
  }
  return Array.from(element.children).map(read).join('');
 };
 const cell=(element:Element)=>children(element,'p').map(read).filter(Boolean).join('<br>').trim();
 const matrix:unknown[][]=[wordQuestionColumns];
 for(const table of Array.from(document.getElementsByTagNameNS(wordNs,'tbl'))){
  const tableRows=children(table,'tr').map(row=>children(row,'tc').map(cell));
  if(!tableRows.length)continue;
  const headers=tableRows[0].map(value=>canonicalField(value.replace(/<[^>]+>/g,'')));
  if(headers.includes('question_text')){
   for(const values of tableRows.slice(1)){const record:Record<string,string>={};headers.forEach((header,index)=>{if(wordQuestionColumns.includes(header))record[header]=values[index]??'';});if(String(record.question_text??'').trim())matrix.push(wordQuestionColumns.map(key=>record[key]??''));}
   continue;
  }
  let record:Record<string,string>={};
  const addRecord=()=>{if(String(record.question_text??'').trim())matrix.push(wordQuestionColumns.map(key=>record[key]??''));};
  for(const row of tableRows){const key=canonicalField((row[0]??'').replace(/<[^>]+>/g,''));if(!wordQuestionColumns.includes(key))continue;if((key==='exam_id'||key==='question_text')&&record.question_text){addRecord();record={};}record[key]=row.slice(1).join(' ').trim();}
  addRecord();
 }
 if(matrix.length===1)throw new Error('Soal belum ditemukan. Isi tabel template Word dengan pertanyaan, opsi, dan kunci jawaban.');
 if(matrix.length>1001)throw new Error('Maksimal 1.000 soal per file.');
 return matrix;
}

function paragraph(value:string){return `<w:p><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:p>`;}
function cellXml(value:string){return `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${paragraph(value)}</w:tc>`;}
export async function downloadWordQuestionTemplate(exam?:{id:number;name:string}){
 const fields:[string,string][]=[['ID ujian',exam?String(exam.id):''],['Jenis soal','MULTIPLE_CHOICE'],['Pertanyaan',''],['Opsi A',''],['Opsi B',''],['Opsi C',''],['Opsi D',''],['Opsi E',''],['Kunci jawaban',''],['Bobot','1']];
 const table=`<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="2300"/><w:gridCol w:w="6500"/></w:tblGrid>${fields.map(([label,value])=>`<w:tr>${cellXml(label)}${cellXml(value)}</w:tr>`).join('')}</w:tbl>`;
 const documentXml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${wordNs}"><w:body>${paragraph(defaultReportIdentity.ministry)}${paragraph(defaultReportIdentity.office)}${paragraph(defaultReportIdentity.school)}${paragraph(defaultReportIdentity.address)}${paragraph('TEMPLATE SOAL ARENA')}${paragraph(exam?`Ujian: ${exam.name} (ID ${exam.id})`:'Template umum: isi ID ujian atau pilih ujian pada layar impor.')}${paragraph('Isi satu tabel untuk satu soal. Salin seluruh tabel untuk menambah soal. Sisipkan Equation Word (Alt+=) atau gambar pada sel Pertanyaan/Opsi. Teks Arab dan subskrip/superskrip Word didukung.')}${paragraph('Jenis soal: MULTIPLE_CHOICE, MULTIPLE_RESPONSE, SHORT_ANSWER. Kunci: A atau A,C. Isian singkat: pisahkan jawaban alternatif dengan |. Opsi A-D wajib untuk pilihan ganda.')}${table}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900"/></w:sectPr></w:body></w:document>`;
 const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`;
 const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;
 const bytes=zipSync({'[Content_Types].xml':strToU8(types),'_rels/.rels':strToU8(rels),'word/document.xml':strToU8(documentXml)},{level:6});
 const output=new Uint8Array(bytes.length);output.set(bytes);
 const objectUrl=URL.createObjectURL(new Blob([output],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));
 const link=document.createElement('a');link.href=objectUrl;link.download=exam?`template-soal-word-${exam.id}.docx`:'template-soal-word-umum.docx';link.click();setTimeout(()=>URL.revokeObjectURL(objectUrl),30000);
}
