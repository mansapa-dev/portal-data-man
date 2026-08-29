import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { resolve } from 'path';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { ImportsModule } from './modules/imports/imports.module';
import { StudentsModule } from './modules/students/students.module';

const staticFrontend = process.env.NODE_ENV === 'production'
  ? [ServeStaticModule.forRoot({ rootPath: resolve(process.cwd(), 'dist/public'), exclude: ['/api/{*path}', '/oidc/{*path}', '/docs/{*path}', '/health'] })]
  : [];

@Module({ imports: [
  ConfigModule.forRoot({ isGlobal: true }),
  LoggerModule.forRoot({ pinoHttp: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'password', 'passwordHash', 'clientSecret', 'access_token', 'refresh_token'] } }),
  ThrottlerModule.forRoot([{ ttl: Number(process.env.RATE_LIMIT_TTL_MS ?? 60000), limit: Number(process.env.RATE_LIMIT_MAX ?? 120) }]),
  ...staticFrontend, PrismaModule, HealthModule, AuthModule, StudentsModule, ImportsModule,
] })
export class AppModule {}
