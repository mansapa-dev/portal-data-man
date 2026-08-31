export type AdminRole='SUPER_ADMIN'|'DATA_ADMIN'|'DATA_OPERATOR'|'AUDITOR';
export function isMenuVisible(role:AdminRole,to:string){if(role==='SUPER_ADMIN')return true;if(role==='AUDITOR')return['/','/imports','/audit-logs','/guide','/profile'].includes(to);if(role==='DATA_OPERATOR'&&to==='/sso/applications')return false;return!['/admin-users','/audit-logs'].includes(to)}
