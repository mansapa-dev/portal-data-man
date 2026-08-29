import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, StudentStatus } from '@prisma/client';
import { ulid } from 'ulid';
import { publicRecord } from '../../common/utils/public-record';
import { PrismaService } from '../../database/prisma.service';
import { CreateStudentDto, StudentQueryDto, UpdateStudentDto } from './dto/student.dto';

@Injectable()
export class StudentsService {
  constructor(private readonly db: PrismaService) {}
  async byNisn(nisn: string) { const row = await this.db.student.findFirst({ where: { nisn, deletedAt: null } }); if (!row) throw new NotFoundException('Siswa tidak ditemukan.'); return publicRecord(row); }
  async list(query: StudentQueryDto) {
    const where: Prisma.StudentWhereInput = { deletedAt: null, ...(query.nisn ? { nisn: query.nisn } : {}), ...(query.status ? { status: query.status as StudentStatus } : {}), ...(query.search ? { OR: [{ fullName: { contains: query.search } }, { nisn: { contains: query.search } }] } : {}) };
    const [data, total] = await this.db.$transaction([this.db.student.findMany({ where, skip: (query.page - 1) * query.perPage, take: query.perPage, orderBy: { [query.sortBy]: query.sortDirection } }), this.db.student.count({ where })]);
    return { message: 'Daftar siswa berhasil diambil.', data: data.map(publicRecord), meta: { page: query.page, perPage: query.perPage, total, totalPages: Math.ceil(total / query.perPage) } };
  }
  async one(publicId: string, includeDeleted = false) { const row = await this.db.student.findFirst({ where: { publicId, ...(includeDeleted ? {} : { deletedAt: null }) } }); if (!row) throw new NotFoundException('Siswa tidak ditemukan.'); return row; }
  async create(dto: CreateStudentDto) {
    try { const row = await this.db.student.create({ data: { publicId: ulid(), nisn: dto.nisn, fullName: dto.fullName.trim().replace(/\s+/g, ' '), parentPhone: dto.parentPhone ?? null, address: dto.address ?? null, rfidUid: dto.rfidUid?.toUpperCase() ?? null, status: (dto.status as StudentStatus | undefined) ?? StudentStatus.ACTIVE } }); return publicRecord(row); }
    catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('NISN atau RFID sudah digunakan.'); throw error; }
  }
  async update(publicId: string, dto: UpdateStudentDto) {
    const row = await this.one(publicId); const data: Prisma.StudentUpdateInput = {};
    if (dto.nisn !== undefined) data.nisn = dto.nisn;
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim().replace(/\s+/g, ' ');
    if (dto.parentPhone !== undefined) data.parentPhone = dto.parentPhone || null;
    if (dto.address !== undefined) data.address = dto.address || null;
    if (dto.rfidUid !== undefined) data.rfidUid = dto.rfidUid ? dto.rfidUid.toUpperCase() : null;
    if (dto.status !== undefined) data.status = dto.status as StudentStatus;
    return publicRecord(await this.db.student.update({ where: { id: row.id }, data }));
  }
  async remove(publicId: string) { const row = await this.one(publicId); await this.db.student.update({ where: { id: row.id }, data: { deletedAt: new Date() } }); }
  async restore(publicId: string) { const row = await this.one(publicId, true); return publicRecord(await this.db.student.update({ where: { id: row.id }, data: { deletedAt: null } })); }
}
