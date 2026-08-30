import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccountStatus, Prisma, StudentStatus, TeacherStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PrismaService } from '../../database/prisma.service';

const MAX_EXPORT_ROWS = Number(process.env.EXPORT_MAX_ROWS ?? 10_000);
const studentHeaders = ['No.', 'NISN', 'Nama Siswa', 'Kelas', 'No. Telepon Orang Tua', 'Alamat', 'RFID UID', 'Status'];
const teacherHeaders = ['NIP', 'NUPTK', 'Nomor Pegawai', 'Nama Guru', 'Jenis Kelamin', 'Email', 'No. Telepon', 'Alamat', 'Status'];

function styleSheet(sheet: ExcelJS.Worksheet, textColumns: number[] = []) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: sheet.getRow(1).getCell(sheet.columnCount).address };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1D4ED8' } };
  sheet.columns.forEach((column) => { column.width = Math.min(42, Math.max(14, ...(column.values ?? []).map((value) => String(value ?? '').length + 2))); });
  for (const index of textColumns) sheet.getColumn(index).numFmt = '@';
}

async function workbookBuffer(workbook: ExcelJS.Workbook) {
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

@Injectable()
export class FilesService {
  constructor(private readonly db: PrismaService) {}

  async studentTemplate() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data Siswa');
    sheet.addRow(studentHeaders);
    sheet.addRow([1, '0012345678', 'Contoh Siswa', '12 - XII.1', '081234567890', 'Alamat contoh', 'A1B2C3D4', 'Aktif']);
    styleSheet(sheet, [2, 5, 7]);
    const guide = workbook.addWorksheet('Petunjuk');
    guide.addRows([
      ['PETUNJUK - hapus baris contoh sebelum import'],
      ['NISN wajib tepat 10 digit dan kolom harus bertipe teks.'],
      ['Kelas mengikuti format seperti 12 - XII.1.'],
      ['Status yang didukung: Aktif.'],
    ]);
    guide.getColumn(1).width = 72;
    return workbookBuffer(workbook);
  }

  async teacherTemplate() {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data Guru');
    sheet.addRow(teacherHeaders);
    sheet.addRow(['198001012010011001', '1234567890123456', 'PEG-001', 'Contoh Guru', 'LAKI_LAKI', 'contoh@example.sch.id', '081234567890', 'Alamat contoh', 'ACTIVE']);
    styleSheet(sheet, [1, 2, 3, 7]);
    const guide = workbook.addWorksheet('Petunjuk');
    guide.addRows([
      ['PETUNJUK - hapus baris contoh sebelum import'],
      ['NIP, NUPTK, nomor pegawai, dan telepon harus bertipe teks.'],
      ['Jenis kelamin: LAKI_LAKI atau PEREMPUAN. Status: ACTIVE atau INACTIVE.'],
    ]);
    guide.getColumn(1).width = 90;
    return workbookBuffer(workbook);
  }

  async students(query: Record<string, string | undefined>) {
    if (query.status && !Object.values(StudentStatus).includes(query.status as StudentStatus)) throw new BadRequestException('Status siswa tidak valid.');
    const enrollment: Prisma.ClassEnrollmentWhereInput = {
      status: 'ACTIVE',
      ...(query.classPublicId ? { schoolClass: { publicId: query.classPublicId } } : {}),
      ...(query.academicYearPublicId ? { academicYear: { publicId: query.academicYearPublicId } } : {}),
      ...(query.semesterPublicId ? { semester: { publicId: query.semesterPublicId } } : {}),
    };
    const hasPeriodFilter = Boolean(query.classPublicId || query.academicYearPublicId || query.semesterPublicId);
    const where: Prisma.StudentWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as StudentStatus } : {}),
      ...(query.search ? { OR: [{ fullName: { contains: query.search } }, { nisn: { contains: query.search } }] } : {}),
      ...(hasPeriodFilter ? { enrollments: { some: enrollment } } : {}),
    };
    const rows = await this.db.student.findMany({
      where,
      select: {
        nisn: true, fullName: true, parentPhone: true, address: true, rfidUid: true, status: true,
        enrollments: {
          where: enrollment, take: 1, orderBy: { enrolledAt: 'desc' },
          select: { attendanceNumber: true, schoolClass: { select: { code: true } }, academicYear: { select: { name: true } }, semester: { select: { type: true } } },
        },
      },
      orderBy: { fullName: 'asc' }, take: MAX_EXPORT_ROWS + 1,
    });
    if (rows.length > MAX_EXPORT_ROWS) throw new BadRequestException(`Export dibatasi ${MAX_EXPORT_ROWS} baris. Persempit filter.`);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Siswa');
    sheet.addRow(['NISN', 'Nama Siswa', 'Kelas Aktif', 'Tahun Ajaran', 'Semester', 'Nomor Absen', 'No. Telepon Orang Tua', 'Alamat', 'RFID UID', 'Status']);
    for (const row of rows) {
      const active = row.enrollments[0];
      sheet.addRow([row.nisn, row.fullName, active?.schoolClass.code ?? '', active?.academicYear.name ?? '', active?.semester.type ?? '', active?.attendanceNumber ?? '', row.parentPhone ?? '', row.address ?? '', row.rfidUid ?? '', row.status]);
    }
    styleSheet(sheet, [1, 7, 9]);
    return { buffer: await workbookBuffer(workbook), count: rows.length };
  }

  async teachers(query: Record<string, string | undefined>) {
    if (query.status && !Object.values(TeacherStatus).includes(query.status as TeacherStatus)) throw new BadRequestException('Status guru tidak valid.');
    if (query.accountStatus && !Object.values(AccountStatus).includes(query.accountStatus as AccountStatus)) throw new BadRequestException('Status akun tidak valid.');
    const where: Prisma.TeacherWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status as TeacherStatus } : {}),
      ...(query.accountStatus ? { account: { status: query.accountStatus as AccountStatus } } : {}),
      ...(query.search ? { OR: [{ fullName: { contains: query.search } }, { nip: { contains: query.search } }, { nuptk: { contains: query.search } }, { employeeNumber: { contains: query.search } }, { email: { contains: query.search } }] } : {}),
    };
    const rows = await this.db.teacher.findMany({
      where,
      select: {
        nip: true, nuptk: true, employeeNumber: true, fullName: true, gender: true, email: true, phone: true, address: true, status: true,
        account: { select: { status: true } }, classes: { where: { deletedAt: null, status: 'ACTIVE' }, select: { code: true }, orderBy: { code: 'asc' } },
      },
      orderBy: { fullName: 'asc' }, take: MAX_EXPORT_ROWS + 1,
    });
    if (rows.length > MAX_EXPORT_ROWS) throw new BadRequestException(`Export dibatasi ${MAX_EXPORT_ROWS} baris. Persempit filter.`);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Guru');
    sheet.addRow(['NIP', 'NUPTK', 'Nomor Pegawai', 'Nama Guru', 'Jenis Kelamin', 'Email', 'No. Telepon', 'Alamat', 'Status', 'Status Akun', 'Kelas Wali']);
    for (const row of rows) sheet.addRow([row.nip ?? '', row.nuptk ?? '', row.employeeNumber ?? '', row.fullName, row.gender ?? '', row.email ?? '', row.phone ?? '', row.address ?? '', row.status, row.account?.status ?? 'BELUM_ADA', row.classes.map((item) => item.code).join(', ')]);
    styleSheet(sheet, [1, 2, 3, 7]);
    return { buffer: await workbookBuffer(workbook), count: rows.length };
  }

  async classStudents(publicId: string, query: Record<string, string | undefined>) {
    const schoolClass = await this.db.schoolClass.findFirst({ where: { publicId, deletedAt: null }, select: { id: true, publicId: true, code: true } });
    if (!schoolClass) throw new NotFoundException('Kelas tidak ditemukan.');
    const rows = await this.db.classEnrollment.findMany({
      where: {
        schoolClassId: schoolClass.id,
        ...(query.semesterPublicId ? { semester: { publicId: query.semesterPublicId } } : {}),
        ...(query.academicYearPublicId ? { academicYear: { publicId: query.academicYearPublicId } } : {}),
      },
      select: { attendanceNumber: true, status: true, enrolledAt: true, leftAt: true, student: { select: { nisn: true, fullName: true } } },
      orderBy: [{ attendanceNumber: 'asc' }, { student: { fullName: 'asc' } }], take: MAX_EXPORT_ROWS + 1,
    });
    if (rows.length > MAX_EXPORT_ROWS) throw new BadRequestException(`Export dibatasi ${MAX_EXPORT_ROWS} baris.`);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Anggota Kelas');
    sheet.addRow(['Nomor Absen', 'NISN', 'Nama Siswa', 'Status Enrollment', 'Tanggal Masuk', 'Tanggal Keluar']);
    for (const row of rows) sheet.addRow([row.attendanceNumber ?? '', row.student.nisn, row.student.fullName, row.status, row.enrolledAt, row.leftAt ?? '']);
    styleSheet(sheet, [2]);
    return { buffer: await workbookBuffer(workbook), count: rows.length, classCode: schoolClass.code };
  }
}
