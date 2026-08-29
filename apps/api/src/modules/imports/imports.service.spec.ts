import { ConflictException } from '@nestjs/common';
import { ImportsService } from './imports.service';

describe('ImportsService commit protection', () => {
  it('menolak batch yang sudah pernah diproses', async () => {
    const db = {
      importBatch: {
        findUnique: jest.fn().mockResolvedValue({ id: 1n, status: 'COMPLETED', rows: [] }),
      },
    };
    const service = new ImportsService(db as never);
    await expect(service.commit('01BATCH')).rejects.toBeInstanceOf(ConflictException);
    expect(db.importBatch.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { publicId: '01BATCH' } }));
  });

  it('menggunakan conditional update untuk mencegah dua worker mengklaim batch yang sama', async () => {
    const db = {
      importBatch: {
        findUnique: jest.fn().mockResolvedValue({ id: 1n, status: 'READY', rows: [] }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      semester: { findFirst: jest.fn().mockResolvedValue({ id: 1n, academicYearId: 1n }) },
    };
    const service = new ImportsService(db as never);
    await expect(service.commit('01BATCH')).rejects.toThrow('Batch sedang atau sudah diproses.');
    expect(db.importBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, status: 'READY' },
      data: { status: 'PROCESSING', startedAt: expect.any(Date) },
    });
  });
});
