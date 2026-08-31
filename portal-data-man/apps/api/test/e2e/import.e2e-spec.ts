import { ConflictException } from '@nestjs/common';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ulid } from 'ulid';
import { ImportsService } from '../../src/modules/imports/imports.service';
import { PrismaService } from '../../src/database/prisma.service';

describe('Import siswa aktual (database)', () => {
  const db = new PrismaService();
  const service = new ImportsService(db);
  const source = resolve(process.cwd(), '../../storage/imports/data-siswa-2026-08-29-185845.xlsx');
  const file = {
    buffer: readFileSync(source),
    originalname: 'data-siswa-2026-08-29-185845.xlsx',
    mimetype: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } as Express.Multer.File;

  beforeAll(async () => {
    process.env.STORAGE_PATH = '/tmp/portal-data-e2e-storage';
    await db.importRowResult.deleteMany();
    await db.importBatch.deleteMany();
    await db.classEnrollment.deleteMany();
    await db.schoolClass.deleteMany();
    await db.student.deleteMany();
    await db.semester.deleteMany();
    await db.academicYear.deleteMany();
    const year = await db.academicYear.create({ data: { publicId: ulid(), name: '2026/2027 E2E', startDate: new Date('2026-07-01'), endDate: new Date('2027-06-30'), isActive: true } });
    await db.semester.create({ data: { publicId: ulid(), academicYearId: year.id, type: 'ODD', startDate: new Date('2026-07-01'), endDate: new Date('2026-12-31'), isActive: true } });
  });

  afterAll(async () => db.$disconnect());

  it('commit idempotent dan tidak menggandakan enrollment', async () => {
    const validation = await service.validate(file, 'E2E_SYSTEM');
    expect(validation.summary).toEqual({ totalRows: 690, validRows: 662, warningRows: 28, failedRows: 0 });
    const first = await service.commit(validation.importPublicId);
    expect(first).toMatchObject({ insertedRows: 690, updatedRows: 0, skippedRows: 0, warningRows: 28, failedRows: 0 });
    await expect(service.commit(validation.importPublicId)).rejects.toBeInstanceOf(ConflictException);

    const repeatValidation = await service.validate(file, 'E2E_SYSTEM');
    const repeat = await service.commit(repeatValidation.importPublicId);
    expect(repeat).toMatchObject({ insertedRows: 0, updatedRows: 0, skippedRows: 690, warningRows: 28, failedRows: 0 });
    await expect(Promise.all([db.student.count(), db.schoolClass.count(), db.classEnrollment.count(), db.classEnrollment.count({ where: { status: 'ACTIVE' } })])).resolves.toEqual([690, 20, 690, 690]);
  }, 60_000);
});
