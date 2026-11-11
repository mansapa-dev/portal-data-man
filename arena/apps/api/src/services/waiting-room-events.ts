import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { performance } from 'node:perf_hooks';
import { WAITING_CHANNEL, type WaitingRoomService } from './waiting-room.js';
import { loadDiagnostics } from '../lib/load-diagnostics.js';

type Client={examId:number;studentId:number;expires:number;reply:FastifyReply;lastPing:number};

export class WaitingRoomEvents {
  private subscriber:Redis|null=null;
  private readonly clients=new Set<Client>();
  // examId → siswa yang berubah. `null` berarti semua klien exam tersebut.
  // Tahap 3: satu siswa join/release tidak lagi memaksa pembacaan ulang 1.200 klien.
  private readonly dirty=new Map<number,Set<number>|null>();
  private timer?:NodeJS.Timeout;
  private inFlight?:Promise<void>;
  constructor(private readonly service:WaitingRoomService) {}
  private mark(examId:number,students:number[]|null) {
    if(!Number.isSafeInteger(examId))return;
    if(students===null){this.dirty.set(examId,null);return;}
    if(this.dirty.get(examId)===null)return;
    let changed=this.dirty.get(examId);
    if(!changed){changed=new Set();this.dirty.set(examId,changed);}
    for(const studentId of students)if(Number.isSafeInteger(studentId))changed.add(studentId);
  }
  start() {
    if (this.timer) return;
    if (this.service.redis) {
      this.subscriber=this.service.redis.duplicate();
      this.subscriber.on('error',()=>{}); // connection errors are reflected by SSE fallback, no per-client log
      this.subscriber.on('ready',()=>{void this.subscriber?.subscribe(WAITING_CHANNEL).catch(()=>{}); for(const client of this.clients)this.dirty.set(client.examId,null);});
      this.subscriber.on('message',(_channel,value)=>{
        try{
          const payload=JSON.parse(value) as {examId?:unknown;students?:unknown};
          const examId=Number(payload.examId);
          if(!Number.isSafeInteger(examId))return;
          // Pesan lama/tanpa daftar siswa diperlakukan sebagai "semua klien".
          this.mark(examId,Array.isArray(payload.students)?payload.students.map(Number):null);
        }catch{/* ignore malformed notifications */}
      });
    }
    this.timer=setInterval(()=>{if(!this.inFlight)this.inFlight=this.flush().finally(()=>{this.inFlight=undefined;});},5000);
    this.timer.unref();
  }
  async connect(request:FastifyRequest,reply:FastifyReply,examId:number,studentId:number,expires:number) {
    const initial=await this.service.status(examId,studentId);
    const same=[...this.clients].filter(c=>c.studentId===studentId && c.examId===examId);
    if(same.length>=2){same[0]!.reply.raw.end();this.clients.delete(same[0]!);}
    reply.hijack();
    for(const [name,value] of Object.entries(reply.getHeaders())) if(value!==undefined)reply.raw.setHeader(name,value);
    reply.raw.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-store','Connection':'keep-alive','X-Accel-Buffering':'no'});
    reply.raw.write('retry: 5000\n\n');
    const client={examId,studentId,expires,reply,lastPing:Date.now()};
    this.clients.add(client);
    reply.raw.on('close',()=>this.clients.delete(client));
    request.raw.on('aborted',()=>{this.clients.delete(client);reply.raw.end();});
    this.send(client,'status',this.service.publicView(initial,examId,studentId,expires));
  }
  private send(client:Client,event:string,value:unknown) {
    if(client.reply.raw.destroyed || client.reply.raw.writableLength>65536 || !client.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`)) {
      this.clients.delete(client);client.reply.raw.end();
    }
  }
  private async flush() {
    const started=performance.now();
    const dirty=new Map(this.dirty);this.dirty.clear();
    const pending=[...this.clients];let index=0,reads=0,skipped=0;
    await Promise.all(Array.from({length:Math.min(32,pending.length)},async()=>{
      while(index<pending.length){
        const client=pending[index++]!;
        if(Date.now()/1000>=client.expires){this.send(client,'expired',{});client.reply.raw.end();this.clients.delete(client);continue;}
        const ping=Date.now()-client.lastPing>=25000;
        const changed=dirty.get(client.examId);
        // `undefined` = exam ini tidak berubah; Set = hanya siswa tertentu;
        // null = semua siswa exam ini. Keepalive tetap dikirim saat ping.
        if(changed===undefined && !ping){skipped++;continue;}
        if(changed instanceof Set && !changed.has(client.studentId) && !ping){skipped++;continue;}
        try {
          reads++;
          const state=await this.service.status(client.examId,client.studentId);
          this.send(client,'status',this.service.publicView(state,client.examId,client.studentId,client.expires));
          if(ping){client.lastPing=Date.now();client.reply.raw.write(': keepalive\n\n');}
        }catch{this.send(client,'connection',{connected:false});client.reply.raw.end();this.clients.delete(client);}
      }
    }));
    if(pending.length)loadDiagnostics.record('waiting_sse_flush',{clients:pending.length,reads,skipped,total_ms:Number((performance.now()-started).toFixed(2))});
  }
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;for(const c of this.clients)c.reply.raw.end();this.clients.clear();await this.inFlight;this.subscriber?.disconnect();}
}
