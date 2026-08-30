import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuditService } from '../audit-logs/audit.service';
import { FilesService } from './files.service';

const exportRoles = ['SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR'] as const;
const timestamp = () => new Date().toISOString().replace(/[:.]/g, '-');
const safeCode = (value: string) => value.replace(/[^A-Za-z0-9._-]/g, '_');

@UseGuards(AdminAuthGuard, CsrfGuard, RolesGuard)
@Controller()
export class FilesController {
  constructor(private readonly files: FilesService, private readonly audit: AuditService) {}

  private send(response: Response, buffer: Buffer, filename: string) {
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    return response.send(buffer);
  }

  @Roles(...exportRoles)
  @Get('import-templates/students')
  async studentTemplate(@Req() request: any, @Res() response: Response) {
    const filename = 'template-import-siswa.xlsx';
    const buffer = await this.files.studentTemplate();
    await this.audit.write({ actorPublicId: request.user.publicId, action: 'TEMPLATE_DOWNLOADED', entityType: 'ImportTemplate', newValues: { type: 'STUDENT', filename } });
    return this.send(response, buffer, filename);
  }

  @Roles(...exportRoles)
  @Get('import-templates/teachers')
  async teacherTemplate(@Req() request: any, @Res() response: Response) {
    const filename = 'template-import-guru.xlsx';
    const buffer = await this.files.teacherTemplate();
    await this.audit.write({ actorPublicId: request.user.publicId, action: 'TEMPLATE_DOWNLOADED', entityType: 'ImportTemplate', newValues: { type: 'TEACHER', filename } });
    return this.send(response, buffer, filename);
  }

  @Roles(...exportRoles)
  @Get('exports/students')
  async students(@Query() query: Record<string, string | undefined>, @Req() request: any, @Res() response: Response) {
    const result = await this.files.students(query);
    await this.audit.write({ actorPublicId: request.user.publicId, action: 'STUDENTS_EXPORTED', entityType: 'Student', newValues: { filters: query, totalRows: result.count } });
    return this.send(response, result.buffer, `export-siswa-${timestamp()}.xlsx`);
  }

  @Roles(...exportRoles)
  @Get('exports/teachers')
  async teachers(@Query() query: Record<string, string | undefined>, @Req() request: any, @Res() response: Response) {
    const result = await this.files.teachers(query);
    await this.audit.write({ actorPublicId: request.user.publicId, action: 'TEACHERS_EXPORTED', entityType: 'Teacher', newValues: { filters: query, totalRows: result.count } });
    return this.send(response, result.buffer, `export-guru-${timestamp()}.xlsx`);
  }

  @Roles(...exportRoles)
  @Get('exports/classes/:publicId/students')
  async classStudents(@Param('publicId') publicId: string, @Query() query: Record<string, string | undefined>, @Req() request: any, @Res() response: Response) {
    const result = await this.files.classStudents(publicId, query);
    await this.audit.write({ actorPublicId: request.user.publicId, action: 'CLASS_STUDENTS_EXPORTED', entityType: 'SchoolClass', entityPublicId: publicId, newValues: { filters: query, totalRows: result.count, classCode: result.classCode } });
    return this.send(response, result.buffer, `anggota-kelas-${safeCode(result.classCode)}-${timestamp()}.xlsx`);
  }
}
