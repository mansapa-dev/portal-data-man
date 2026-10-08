type Sheet={['!cols']?:Array<{wch:number}>;['!autofilter']?:{ref:string}};
type Workbook={SheetNames:string[];Sheets:Record<string,Sheet>};
type XlsxApi={writeFile:(book:Workbook,name:string,options?:{cellStyles?:boolean})=>void;utils:{book_new:()=>Workbook;aoa_to_sheet:(rows:unknown[][])=>Sheet;book_append_sheet:(book:Workbook,sheet:Sheet,name:string)=>void;encode_col:(column:number)=>string}};

function library(){const value=(window as unknown as {XLSX?:XlsxApi}).XLSX;if(!value)throw new Error('Pembuat Excel belum termuat. Periksa koneksi lalu muat ulang halaman.');return value;}
export function safeFilename(value:string){return value.normalize('NFKD').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'').toLowerCase().slice(0,80)||'data';}
export function exportExcel(filename:string,sheets:Array<{name:string;rows:unknown[][];widths?:number[]}>){const xlsx=library(),book=xlsx.utils.book_new();for(const item of sheets){const sheet=xlsx.utils.aoa_to_sheet(item.rows),columns=Math.max(1,...item.rows.map(row=>row.length));sheet['!cols']=Array.from({length:columns},(_,index)=>({wch:item.widths?.[index]??18}));if(item.rows.length>1)sheet['!autofilter']={ref:`A1:${xlsx.utils.encode_col(columns-1)}${item.rows.length}`};xlsx.utils.book_append_sheet(book,sheet,item.name.slice(0,31));}xlsx.writeFile(book,filename,{cellStyles:true});}
