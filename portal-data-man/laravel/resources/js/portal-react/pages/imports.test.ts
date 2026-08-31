import { describe, expect, it } from 'vitest';
import { validateImportFile } from './imports';

const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = (name: string, type = xlsx, size = 4) => new File([new Uint8Array(size)], name, { type });

describe('student import file validation', () => {
  it('accepts an XLSX file', () => expect(validateImportFile(file('siswa.xlsx'))).toBeNull());
  it.each(['siswa.xls', 'siswa.csv', 'siswa.zip'])('rejects %s', (name) => expect(validateImportFile(file(name))).toMatch(/\.xlsx/));
  it.each(['application/zip', 'application/octet-stream', ''])('accepts browser MIME %s for a valid .xlsx filename', (type) => expect(validateImportFile(file('siswa.xlsx', type))).toBeNull());
  it('rejects an empty file', () => expect(validateImportFile(file('siswa.xlsx', xlsx, 0))).toMatch(/kosong/));
  it('rejects a file over the configured size', () => expect(validateImportFile(file('siswa.xlsx', xlsx, 11), 0.00001)).toMatch(/maksimal/));
});
