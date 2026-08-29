import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet'; import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
async function bootstrap(){const app=await NestFactory.create(AppModule,{bufferLogs:true}); const express=app.getHttpAdapter().getInstance(); express.set('trust proxy',Number(process.env.TRUST_PROXY??1)); app.use(helmet({contentSecurityPolicy:false})); app.use(cookieParser()); app.enableCors({origin:(process.env.CORS_ORIGINS??'http://localhost:3000').split(','),credentials:true}); app.setGlobalPrefix(process.env.API_PREFIX??'api/v1',{exclude:['oidc/(.*)','health']}); app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true})); app.useGlobalFilters(new HttpExceptionFilter()); app.useGlobalInterceptors(new ResponseInterceptor()); app.enableShutdownHooks(); if(process.env.SWAGGER_ENABLED!=='false'){const config=new DocumentBuilder().setTitle('Portal Data API').setDescription('API sumber data sekolah dan identity provider').setVersion('1.0').addCookieAuth('portal_session').addBearerAuth().build(); SwaggerModule.setup('docs',app,SwaggerModule.createDocument(app,config));} await app.listen(Number(process.env.PORT??3000),'0.0.0.0');}
void bootstrap();
