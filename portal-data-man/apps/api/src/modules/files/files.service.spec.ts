import ExcelJS from 'exceljs';
import { FilesService } from './files.service';

describe('FilesService templates', () => {
  const service = new FilesService({} as never);

  it('creates a student template readable by the existing importer', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.studentTemplate() as any);
    const sheet = workbook.getWorksheet('Data Siswa')!;
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      'No.', 'NISN', 'Nama Siswa', 'Kelas', 'No. Telepon Orang Tua', 'Alamat', 'RFID UID', 'Status',
    ]);
    expect(sheet.getCell('B2').value).toBe('0012345678');
    expect(sheet.getColumn(2).numFmt).toBe('@');
    expect(workbook.getWorksheet('Petunjuk')).toBeDefined();
  });

  it('creates a teacher template with text identifiers and no actual records', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await service.teacherTemplate() as any);
    const sheet = workbook.getWorksheet('Data Guru')!;
    expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([
      'NIP', 'NUPTK', 'Nomor Pegawai', 'Nama Guru', 'Jenis Kelamin', 'Email', 'No. Telepon', 'Alamat', 'Status',
    ]);
    expect(sheet.getColumn(1).numFmt).toBe('@');
    expect(sheet.getColumn(7).numFmt).toBe('@');
    expect(String(sheet.getCell('D2').value)).toContain('Contoh');
  });
});
