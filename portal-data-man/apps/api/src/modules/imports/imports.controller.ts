import { BadRequestException, Controller, Param, Post, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { extname } from 'path';
import { AdminAuthGuard } from '../../auth/guards/admin-auth.guard';
import { CsrfGuard } from '../../auth/guards/csrf.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ImportsService } from './imports.service';

@UseGuards(AdminAuthGuard, CsrfGuard, RolesGuard)
@Controller('imports/students')
export class ImportsController {
  constructor(private readonly service: ImportsService) {}

  @Roles('SUPER_ADMIN', 'DATA_ADMIN', 'DATA_OPERATOR')
  @Post('validate')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: Number(process.env.IMPORT_MAX_FILE_SIZE_MB ?? 10) * 1024 * 1024 } }))
  async validate(@UploadedFile() file: Express.Multer.File, @Req() request: any) {
    if (!file) throw new BadRequestException('File Excel wajib diunggah.');
    if (extname(file.originalname).toLowerCase() !== '.xlsx') throw new BadRequestException('Ekstensi file harus .xlsx.');
    if (file.buffer.length < 4 || file.buffer[0] !== 0x50 || file.buffer[1] !== 0x4b) throw new BadRequestException('Signature file XLSX tidak valid.');
    return { message: 'File selesai divalidasi.', data: await this.service.validate(file, request.user.publicId) };
  }

  @Roles('SUPER_ADMIN', 'DATA_ADMIN')
  @Post(':publicId/commit')
  async commit(@Param('publicId') publicId: string, @Req() request: any) {
    return { message: 'Import selesai diproses.', data: await this.service.commit(publicId, request.user.publicId) };
  }
}
