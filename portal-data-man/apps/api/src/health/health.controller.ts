import { Controller, Get } from '@nestjs/common'; import { PrismaService } from '../database/prisma.service';
@Controller('health') export class HealthController { constructor(private db:PrismaService){} @Get() async check(){await this.db.$queryRaw`SELECT 1`;return {message:'Portal Data sehat.',data:{status:'ok',database:'connected',time:new Date().toISOString()}};} }
