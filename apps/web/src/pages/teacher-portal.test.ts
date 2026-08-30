import{describe,expect,it}from'vitest';import{validTeacherPassword}from'./teacher-portal';
describe('teacher password UI policy',()=>{it('accepts a strong password',()=>expect(validTeacherPassword('PasswordBaru123')).toBe(true));it.each(['Pendek1A','tanpabesar123','TANPAKECIL123','TanpaAngkaaa'])('rejects %s',value=>expect(validTeacherPassword(value)).toBe(false))});
