export const schoolLogoPath='/assets/img/logo-man1-palembang.png';

export type ReportIdentity={ministry:string;office:string;school:string;address:string;principal:string;principalNip:string;curriculum:string;curriculumNip:string};

export const defaultReportIdentity:ReportIdentity={
 ministry:'KEMENTERIAN AGAMA REPUBLIK INDONESIA',
 office:'KANTOR KEMENTERIAN AGAMA KOTA PALEMBANG',
 school:'MADRASAH ALIYAH NEGERI 1 PALEMBANG',
 address:'Jln. Gub. H. Bastari (Jln. Pendidikan), Jakabaring, Palembang, Sumatera Selatan',
 principal:'',principalNip:'',curriculum:'',curriculumNip:'',
};

export function escapePrint(value:unknown){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));}

export function printLetterhead(identity:ReportIdentity,compact=false){return `<header class="print-letterhead${compact?' compact':''}"><img src="${schoolLogoPath}" alt="Lambang MAN 1 Palembang"><div><div>${escapePrint(identity.ministry)}</div><div>${escapePrint(identity.office)}</div><strong>${escapePrint(identity.school)}</strong><small>${escapePrint(identity.address)}</small></div></header>`;}

export function letterheadRows(identity:ReportIdentity){return [[identity.ministry],[identity.office],[identity.school],[identity.address]];}

export const printBaseCss=`*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#172620;margin:18px auto;max-width:1040px}button{padding:8px 13px;margin-bottom:12px}.print-letterhead{display:flex;align-items:center;justify-content:center;gap:18px;text-align:center;border-bottom:3px double #315b3e;padding:0 0 12px;margin-bottom:16px}.print-letterhead img{width:72px;height:72px;object-fit:contain;flex:none}.print-letterhead strong{display:block;font-size:16px}.print-letterhead small{display:block;font-size:11px;margin-top:4px}.print-letterhead.compact{justify-content:flex-start;text-align:left;gap:8px;border-bottom:1px solid #315b3e;padding-bottom:6px;margin-bottom:8px}.print-letterhead.compact img{width:34px;height:34px}.print-letterhead.compact div div{display:none}.print-letterhead.compact strong{font-size:10px}.print-letterhead.compact small{display:none}table{width:100%;border-collapse:collapse}th,td{border:1px solid #9ca9a0;padding:5px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}@media print{button,.print-only-screen{display:none!important}body{margin:0;max-width:none;print-color-adjust:exact;-webkit-print-color-adjust:exact}}`;
