import { strFromU8, unzipSync } from 'fflate';

export type EmbeddedImage = { row: number; column: number; dataUrl?: string; mathml?: string; unsupported?: string };

const relationshipsNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const mathNamespace = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const imageTypes: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

function resolvePath(base: string, target: string) {
  const parts = (target.startsWith('/') ? target.slice(1) : `${base}/${target}`).split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') result.pop();
    else result.push(part);
  }
  return result.join('/');
}

function relationPath(path: string) {
  const slash = path.lastIndexOf('/');
  return `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
}

function xml(files: Record<string, Uint8Array>, path: string) {
  const content = files[path];
  if (!content) return null;
  return new DOMParser().parseFromString(strFromU8(content), 'application/xml');
}

function relations(files: Record<string, Uint8Array>, path: string) {
  const document = xml(files, path);
  const output = new Map<string, string>();
  for (const relation of Array.from(document?.getElementsByTagNameNS('*', 'Relationship') ?? [])) {
    const id = relation.getAttribute('Id');
    const target = relation.getAttribute('Target');
    if (id && target && relation.getAttribute('TargetMode') !== 'External') output.set(id, target);
  }
  return output;
}

function base64(bytes: Uint8Array) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

function escapeXml(value: string) { return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'); }
function mathChildren(element: Element) { return Array.from(element.children).filter(child => child.namespaceURI === mathNamespace); }
function mathText(element: Element | null) { return element ? Array.from(element.getElementsByTagNameNS(mathNamespace,'t')).map(node=>node.textContent??'').join('') : ''; }
function convertOmml(element: Element): string {
  const children=mathChildren(element), name=element.localName;
  const content=(child:Element|null)=>child?mathChildren(child).map(convertOmml).join('')||escapeXml(mathText(child)):'';
  if(name==='oMath'||name==='oMathPara'||name==='e'||name==='num'||name==='den'||name==='sub'||name==='sup'||name==='fName'||name==='deg'||name==='lim'||name==='mr'||name==='box'||name==='t')return name==='t'?escapeXml(element.textContent??''):children.map(convertOmml).join('')||escapeXml(mathText(element));
  if(name==='f')return `<mfrac>${content(children.find(child=>child.localName==='num')??null)}${content(children.find(child=>child.localName==='den')??null)}</mfrac>`;
  if(name==='sSup'||name==='sSub'||name==='sSubSup'){const base=content(children.find(child=>child.localName==='e')??null),sub=content(children.find(child=>child.localName==='sub')??null),sup=content(children.find(child=>child.localName==='sup')??null);return name==='sSup'?`<msup>${base}${sup}</msup>`:name==='sSub'?`<msub>${base}${sub}</msub>`:`<msubsup>${base}${sub}${sup}</msubsup>`;}
  if(name==='rad'){const base=content(children.find(child=>child.localName==='e')??null),degree=content(children.find(child=>child.localName==='deg')??null),hidden=element.getElementsByTagNameNS(mathNamespace,'degHide')[0]?.getAttribute('val')==='1';return !degree||hidden?`<msqrt>${base}</msqrt>`:`<mroot>${base}${degree}</mroot>`;}
  if(name==='nary'){const props=children.find(child=>child.localName==='naryPr'),symbol=props?.getElementsByTagNameNS(mathNamespace,'chr')[0]?.getAttribute('val')??'∑',base=content(children.find(child=>child.localName==='e')??null),sub=content(children.find(child=>child.localName==='sub')??null),sup=content(children.find(child=>child.localName==='sup')??null),operator=`<mo>${escapeXml(symbol)}</mo>`;return sub&&sup?`<munderover>${operator}${sub}${sup}</munderover>${base}`:sub?`<munder>${operator}${sub}</munder>${base}`:sup?`<mover>${operator}${sup}</mover>${base}`:`${operator}${base}`;}
  if(name==='acc'||name==='bar'||name==='limUpp'||name==='groupChr'){const base=content(children.find(child=>child.localName==='e')??null),symbol=element.getElementsByTagNameNS(mathNamespace,'chr')[0]?.getAttribute('val')??(name==='bar'?'¯':'ˆ');return `<mover accent="true">${base}<mo>${escapeXml(symbol)}</mo></mover>`;}
  if(name==='limLow'){const base=content(children.find(child=>child.localName==='e')??null),limit=content(children.find(child=>child.localName==='lim')??null);return `<munder>${base}${limit}</munder>`;}
  if(name==='d'){const props=children.find(child=>child.localName==='dPr'),begin=props?.getElementsByTagNameNS(mathNamespace,'begChr')[0]?.getAttribute('val')??'(',end=props?.getElementsByTagNameNS(mathNamespace,'endChr')[0]?.getAttribute('val')??')',inner=children.filter(child=>child.localName==='e').map(child=>convertOmml(child)).join('');return `<mrow><mo>${escapeXml(begin)}</mo>${inner}<mo>${escapeXml(end)}</mo></mrow>`;}
  if(name==='matrix'){const rows=children.filter(child=>child.localName==='mr').map(row=>`<mtr>${mathChildren(row).filter(cell=>cell.localName==='e').map(cell=>`<mtd>${convertOmml(cell)}</mtd>`).join('')}</mtr>`).join('');return `<mtable>${rows}</mtable>`;}
  if(name==='eqArr')return `<mtable>${children.filter(child=>child.localName==='e').map(row=>`<mtr><mtd>${convertOmml(row)}</mtd></mtr>`).join('')}</mtable>`;
  if(name==='func'){const func=content(children.find(child=>child.localName==='fName')??null),arg=content(children.find(child=>child.localName==='e')??null);return `${func}${arg}`;}
  if(name==='phant')return `<mphantom>${children.map(convertOmml).join('')}</mphantom>`;
  if(name==='bracket'||name==='borderBox')return `<menclose notation="box">${children.map(convertOmml).join('')}</menclose>`;
  if(name==='r'){const text=Array.from(element.getElementsByTagNameNS(mathNamespace,'t')).map(node=>node.textContent??'').join('');return `<mi>${escapeXml(text)}</mi>`;}
  if(name.endsWith('Pr')||name==='ctrlPr'||name==='argPr'||name==='ctrlPr')return '';
  return children.map(convertOmml).join('')||escapeXml(mathText(element));
}

export function extractSheetImages(buffer: ArrayBuffer, sheetIndex = 0): EmbeddedImage[] {
  const files = unzipSync(new Uint8Array(buffer));
  const workbook = xml(files, 'xl/workbook.xml');
  const selectedSheet = workbook?.getElementsByTagNameNS('*', 'sheet')[sheetIndex];
  const sheetId = selectedSheet?.getAttributeNS(relationshipsNamespace, 'id') ?? selectedSheet?.getAttribute('r:id');
  if (!sheetId) return [];

  const workbookRels = relations(files, 'xl/_rels/workbook.xml.rels');
  const sheetPath = resolvePath('xl', workbookRels.get(sheetId) ?? '');
  const sheet = xml(files, sheetPath);
  const dimension = sheet?.getElementsByTagNameNS('*', 'dimension')[0]?.getAttribute('ref') ?? 'A1';
  const startRow = Number(dimension.match(/^[A-Z]+(\d+)/)?.[1] ?? 1) - 1;
  const drawingId = sheet?.getElementsByTagNameNS('*', 'drawing')[0]?.getAttributeNS(relationshipsNamespace, 'id')
    ?? sheet?.getElementsByTagNameNS('*', 'drawing')[0]?.getAttribute('r:id');
  if (!drawingId) return [];

  const sheetRels = relations(files, relationPath(sheetPath));
  const drawingPath = resolvePath(sheetPath.slice(0, sheetPath.lastIndexOf('/')), sheetRels.get(drawingId) ?? '');
  const drawing = xml(files, drawingPath);
  if (!drawing) return [];
  const drawingRels = relations(files, relationPath(drawingPath));
  const images: EmbeddedImage[] = [];

  for (const anchor of Array.from(drawing.getElementsByTagNameNS('*', 'twoCellAnchor')).concat(Array.from(drawing.getElementsByTagNameNS('*', 'oneCellAnchor')))) {
    const from = anchor.getElementsByTagNameNS('*', 'from')[0];
    const row = Number(from?.getElementsByTagNameNS('*', 'row')[0]?.textContent);
    const column = Number(from?.getElementsByTagNameNS('*', 'col')[0]?.textContent);
    if (!Number.isInteger(row) || !Number.isInteger(column)) continue;
    for (const picture of Array.from(anchor.getElementsByTagNameNS('*', 'pic'))) {
      const blip = picture.getElementsByTagNameNS('*', 'blip')[0];
      const relationId = blip?.getAttributeNS(relationshipsNamespace, 'embed') ?? blip?.getAttribute('r:embed');
      const target = relationId && drawingRels.get(relationId);
      if (!target) continue;
      const imagePath = resolvePath(drawingPath.slice(0, drawingPath.lastIndexOf('/')), target);
      const bytes = files[imagePath];
      const extension = imagePath.split('.').pop()?.toLowerCase() ?? '';
      const mime = imageTypes[extension];
      if (bytes) images.push(mime ? { row: row - startRow, column, dataUrl: `data:${mime};base64,${base64(bytes)}` } : { row: row - startRow, column, unsupported: extension || 'unknown' });
    }
    for (const equation of Array.from(anchor.getElementsByTagNameNS(mathNamespace,'oMath'))) {
      if (equation.parentElement?.localName === 'oMathPara') continue;
      const markup=convertOmml(equation);
      if(markup)images.push({row:row-startRow,column,mathml:`<math xmlns="http://www.w3.org/1998/Math/MathML">${markup}</math>`});
    }
  }
  return images;
}
