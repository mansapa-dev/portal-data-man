import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ImportRowStatus, ImportStatus, ImportType, Prisma } from '@prisma/client';
import { Response } from 'express';
import { existsSync } from 'fs';
import { basename, resolve, sep } from 'path';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit-logs/audit.service';

const readRoles = ['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR', 'AUDITOR'] as const;
const publicIdPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/i;

function positiveInt(value: unknown, fallback: number, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new BadRequestException(`Nilai pagination harus bilangan 1-${max}.`);
  }
  return parsed;
}

function validDate(value: unknown, endOfDay = false) {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException('Tanggal harus berformat YYYY-MM-DD.');
  }
  const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
  if (Number.isNaN(date.valueOf())) throw new BadRequestException('Tanggal tidak valid.');
  return date;
}

function assertPublicId(publicId: string) {
  if (!publicIdPattern.test(publicId)) throw new BadRequestException('Public ID tidak valid.');
}

function sanitizedNormalizedData(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, Prisma.JsonValue>;
  return {
    nisn: typeof row.nisn === 'string' ? row.nisn : undefined,
    fullName: typeof row.fullName === 'string' ? row.fullName : undefined,
    classCode: typeof row.classCode === 'string' ? row.classCode : undefined,
    gradeLevel: typeof row.gradeLevel === 'number' ? row.gradeLevel : undefined,
    status: typeof row.status === 'string' ? row.status : undefined,
  };
}

@UseGuards(AdminAuthGuard, CsrfGuard, RolesGuard)
@Roles(...readRoles)
@Controller('imports')
export class ImportsManagementController {
  constructor(
    private readonly db: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async list(@Query() query: Record<string, string | undefined>) {
    const page = positiveInt(query.page, 1);
    const perPage = positiveInt(query.perPage, 25, 100);
    const sortDirection = query.sortDirection ?? 'desc';
    if (!['asc', 'desc'].includes(sortDirection)) throw new BadRequestException('Arah sorting tidak valid.');
    const allowedSort = ['createdAt', 'originalFilename', 'status', 'type'];
    const sortBy = query.sortBy ?? 'createdAt';
    if (!allowedSort.includes(sortBy)) throw new BadRequestException('Field sorting tidak valid.');
    if (query.type && !Object.values(ImportType).includes(query.type as ImportType)) throw new BadRequestException('Tipe import tidak valid.');
    if (query.status && !Object.values(ImportStatus).includes(query.status as ImportStatus)) throw new BadRequestException('Status import tidak valid.');
    const dateFrom = validDate(query.dateFrom);
    const dateTo = validDate(query.dateTo, true);
    const createdAt = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
    const where: Prisma.ImportBatchWhereInput = {
      ...(query.type ? { type: query.type as ImportType } : {}),
      ...(query.status ? { status: query.status as ImportStatus } : {}),
      ...(query.createdBy ? { createdBy: query.createdBy } : {}),
      ...(dateFrom || dateTo ? { createdAt } : {}),
      ...(query.search ? { originalFilename: { contains: query.search.trim() } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.importBatch.findMany({
        where,
        select: {
          publicId: true, type: true, originalFilename: true, status: true,
          totalRows: true, validRows: true, insertedRows: true, updatedRows: true,
          skippedRows: true, warningRows: true, failedRows: true, createdBy: true,
          createdAt: true, startedAt: true, completedAt: true, errorFilePath: true,
        },
        orderBy: { [sortBy]: sortDirection },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.db.importBatch.count({ where }),
    ]);
    return {
      data: items.map(({ errorFilePath, ...item }) => ({ ...item, hasErrorFile: Boolean(errorFilePath) })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  @Get(':publicId/rows')
  async rows(@Param('publicId') publicId: string, @Query() query: Record<string, string | undefined>) {
    assertPublicId(publicId);
    const batch = await this.db.importBatch.findUnique({ where: { publicId }, select: { id: true } });
    if (!batch) throw new NotFoundException('Batch import tidak ditemukan.');
    const page = positiveInt(query.page, 1);
    const perPage = positiveInt(query.perPage, 25, 100);
    if (query.status && !Object.values(ImportRowStatus).includes(query.status as ImportRowStatus)) throw new BadRequestException('Status baris tidak valid.');
    const where: Prisma.ImportRowResultWhereInput = {
      importBatchId: batch.id,
      ...(query.status ? { status: query.status as ImportRowStatus } : {}),
      ...(query.search ? { identifier: { contains: query.search.trim() } } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.importRowResult.findMany({
        where,
        select: { rowNumber: true, identifier: true, status: true, messages: true, normalizedData: true },
        orderBy: { rowNumber: 'asc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.db.importRowResult.count({ where }),
    ]);
    return {
      data: items.map((item) => ({ ...item, normalizedData: sanitizedNormalizedData(item.normalizedData) })),
      meta: { page, perPage, total, totalPages: Math.ceil(total / perPage) },
    };
  }

  @Get(':publicId/error-file')
  async errorFile(@Param('publicId') publicId: string, @Req() request: any, @Res() response: Response) {
    assertPublicId(publicId);
    const batch = await this.db.importBatch.findUnique({
      where: { publicId },
      select: { publicId: true, type: true, originalFilename: true, errorFilePath: true, failedRows: true },
    });
    if (!batch?.errorFilePath) throw new NotFoundException('File kesalahan tidak tersedia.');
    const storageRoot = resolve(process.env.STORAGE_PATH ?? 'storage');
    const filePath = resolve(storageRoot, batch.errorFilePath);
    if (!filePath.startsWith(`${storageRoot}${sep}`) || !existsSync(filePath)) throw new NotFoundException('File kesalahan tidak tersedia.');
    await this.audit.write({
      actorPublicId: request.user.publicId,
      action: 'IMPORT_ERROR_FILE_DOWNLOADED',
      entityType: 'ImportBatch',
      entityPublicId: publicId,
      newValues: { type: batch.type, filename: basename(batch.originalFilename), failedRows: batch.failedRows },
    });
    return response.download(filePath, `import-errors-${publicId}.xlsx`);
  }

  @Get(':publicId')
  async one(@Param('publicId') publicId: string) {
    assertPublicId(publicId);
    const item = await this.db.importBatch.findUnique({
      where: { publicId },
      select: {
        publicId: true, type: true, originalFilename: true, status: true,
        totalRows: true, validRows: true, insertedRows: true, updatedRows: true,
        skippedRows: true, warningRows: true, failedRows: true, createdBy: true,
        createdAt: true, startedAt: true, completedAt: true, errorFilePath: true,
      },
    });
    if (!item) throw new NotFoundException('Batch import tidak ditemukan.');
    const { errorFilePath, ...safeItem } = item;
    return { message: 'Batch import berhasil diambil.', data: { ...safeItem, hasErrorFile: Boolean(errorFilePath) } };
  }
}
