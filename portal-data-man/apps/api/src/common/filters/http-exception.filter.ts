import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
@Catch() export class HttpExceptionFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){const res=host.switchToHttp().getResponse<Response>(); const status=error instanceof HttpException?error.getStatus():500; const raw=error instanceof HttpException?error.getResponse():null; const obj=typeof raw==='object'&&raw?raw as any:{}; const messages=Array.isArray(obj.message)?obj.message:undefined; res.status(status===400&&messages?422:status).json({success:false,message:status===500?'Terjadi kesalahan internal.':messages?'Validasi gagal.':obj.message??'Permintaan gagal.',...(messages?{errors:{general:messages}}:{})});}
}
