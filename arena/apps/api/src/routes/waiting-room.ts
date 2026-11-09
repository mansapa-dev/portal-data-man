import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { assertCsrf, claimsFromRequest, rateLimitKey } from '../lib/auth.js';
import { requireRole } from '../lib/access.js';
import { waitingRoom } from '../lib/waiting-room.js';
import { requirePool } from '../lib/db.js';
import { audit } from '../services/audit.js';
import type { WaitingRoomService } from '../services/waiting-room.js';
import type { WaitingRoomEvents } from '../services/waiting-room-events.js';

const id=z.coerce.number().int().positive();
const settingsSchema=z.object({queue_open:z.union([z.literal(0),z.literal(1)]),batch_size:z.number().int().min(1).max(1000),batch_interval_ms:z.number().int().min(1000).max(3600000),heartbeat_timeout_ms:z.number().int().min(10000).max(600000),claim_timeout_ms:z.number().int().min(10000).max(600000)}).strict();
const limit=(max:number)=>({rateLimit:{max,timeWindow:'1 minute',keyGenerator:rateLimitKey}});

export async function waitingRoomRoutes(app:FastifyInstance,options:{service?:WaitingRoomService;events:WaitingRoomEvents}) {
  const service=options.service ?? waitingRoom;
  const student=(request:FastifyRequest,mutate=false)=>{
    const claims=claimsFromRequest(request);
    if(claims.role!=='STUDENT')throw Object.assign(new Error('Sesi siswa diperlukan'),{statusCode:403});
    if(mutate)assertCsrf(request,claims);
    return claims;
  };
  app.addHook('onSend',async(_request,reply,payload)=>{reply.header('Cache-Control','no-store');return payload;});
  app.post<{Params:{id:string}}>('/api/student/exams/:id/waiting/join',{config:limit(12)},async request=>{
    const claims=student(request,true),examId=id.parse(request.params.id);
    const body=z.object({rejoin:z.boolean().optional()}).strict().parse(request.body ?? {});
    return service.publicView(await service.join(examId,claims.sub,body.rejoin),examId,claims.sub,claims.exp);
  });
  app.get<{Params:{id:string}}>('/api/student/exams/:id/waiting/status',{config:limit(24)},async request=>{
    const claims=student(request),examId=id.parse(request.params.id);
    return service.publicView(await service.status(examId,claims.sub),examId,claims.sub,claims.exp);
  });
  app.post<{Params:{id:string}}>('/api/student/exams/:id/waiting/heartbeat',{config:limit(60)},async request=>{
    const claims=student(request,true),examId=id.parse(request.params.id);
    return service.publicView(await service.heartbeat(examId,claims.sub),examId,claims.sub,claims.exp);
  });
  app.post<{Params:{id:string}}>('/api/student/exams/:id/waiting/leave',{config:limit(12)},async request=>{
    const claims=student(request,true),examId=id.parse(request.params.id);
    return service.publicView(await service.leave(examId,claims.sub),examId,claims.sub,claims.exp);
  });
  app.post<{Params:{id:string}}>('/api/student/exams/:id/waiting/resume',{config:limit(12)},async request=>{
    const claims=student(request,true),examId=id.parse(request.params.id);
    return service.publicView(await service.resume(examId,claims.sub),examId,claims.sub,claims.exp);
  });
  app.get<{Params:{id:string}}>('/api/student/exams/:id/waiting/events',{config:limit(12)},async(request,reply)=>{
    const claims=student(request),examId=id.parse(request.params.id);
    const {ticket}=z.object({ticket:z.string().max(2000)}).strict().parse(request.query);
    service.verifyStreamTicket(ticket,examId,claims.sub);
    return options.events.connect(request,reply,examId,claims.sub,claims.exp);
  });
  app.get<{Params:{id:string}}>('/api/admin/waiting-room/:id',async request=>{
    requireRole(request,['ADMIN']);const examId=id.parse(request.params.id);
    return service.publicView(await service.summary(examId),examId,0,0);
  });
  app.put<{Params:{id:string}}>('/api/admin/waiting-room/:id/settings',async request=>{
    const actor=requireRole(request,['ADMIN'],true),examId=id.parse(request.params.id);
    const settings=settingsSchema.parse(request.body);
    const result=await service.updateSettings(examId,settings);
    await audit(requirePool(),actor.sub,actor.role,'WAITING_SETTINGS_CHANGED','Exam',examId,undefined,settings);
    return service.publicView(result,examId,0,0);
  });
  app.post<{Params:{id:string}}>('/api/admin/waiting-room/:id/release',async request=>{
    const actor=requireRole(request,['ADMIN'],true),examId=id.parse(request.params.id);
    const {expected_batch}=z.object({expected_batch:z.number().int().nonnegative()}).strict().parse(request.body);
    await service.configure(examId);
    const result=await service.release(examId,true,expected_batch);
    await audit(requirePool(),actor.sub,actor.role,'WAITING_BATCH_RELEASED','Exam',examId,undefined,{batch:result.batch_id,count:result.released?.length ?? 0});
    return service.publicView(result,examId,0,0);
  });
}
