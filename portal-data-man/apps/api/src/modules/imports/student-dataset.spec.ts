import ExcelJS from 'exceljs';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { normalizeStudentRow, STUDENT_HEADERS, StudentImportRow } from './student-normalizer';

describe('dataset siswa aktual', () => {
  const file = resolve(process.cwd(), '../../storage/imports/data-siswa-2026-08-29-185845.xlsx');
  const run = existsSync(file) ? it : it.skip;
  run('membaca 690 NISN unik dan 20 kelas', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(file);
    expect(workbook.worksheets).toHaveLength(1);
    const sheet = workbook.worksheets[0]!;
    expect((sheet.getRow(1).values as unknown[]).slice(1).map(String)).toEqual(STUDENT_HEADERS);
    const normalized: StudentImportRow[] = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const values = Object.fromEntries(STUDENT_HEADERS.map((header, index) => [header, row.getCell(index + 1).value]));
      normalized.push(normalizeStudentRow(values));
    });
    expect(normalized).toHaveLength(690);
    expect(new Set(normalized.map((row) => row.nisn)).size).toBe(690);
    expect(normalized.every((row) => /^\d{10}$/.test(row.nisn))).toBe(true);
    expect(normalized.some((row) => row.nisn.startsWith('0'))).toBe(true);
    const classes = new Set(normalized.map((row) => row.classCode));
    expect(classes.size).toBe(20);
    expect(classes.has('XII.9')).toBe(true);
    expect(classes.has('XII.10')).toBe(true);
    const names = new Map<string, number>();
    normalized.forEach((row) => names.set(row.fullName, (names.get(row.fullName) ?? 0) + 1));
    expect([...names.values()].some((count) => count > 1)).toBe(true);
    expect(normalized.some((row) => row.warnings.some((message) => message.includes('telepon')))).toBe(true);
    expect(normalized.some((row) => row.warnings.some((message) => message.includes('RFID')))).toBe(true);
  });
});
