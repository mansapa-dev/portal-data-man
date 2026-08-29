import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
@Injectable() export class ResponseInterceptor implements NestInterceptor {
 intercept(_:ExecutionContext,next:CallHandler):Observable<unknown>{return next.handle().pipe(map((value:any)=>{
   if(value?.success!==undefined) return value;
   if(value?.data && value?.meta) return {success:true,message:value.message??'Data berhasil diambil.',data:value.data,meta:value.meta};
   return {success:true,message:value?.message??'Permintaan berhasil.',data:value?.data??value??null};
 }));}
}
