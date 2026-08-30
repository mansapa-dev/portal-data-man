import { Module } from '@nestjs/common';
import { ImportsController } from './imports.controller';
import { ImportsManagementController } from './imports-management.controller';
import { ImportsService } from './imports.service';

@Module({
  controllers: [ImportsController, ImportsManagementController],
  providers: [ImportsService],
})
export class ImportsModule {}
