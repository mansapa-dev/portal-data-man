import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import { WAITING_CHANNEL, type WaitingRoomService } from './waiting-room.js';

type Client={examId:number;studentId:number;expires:number;reply:FastifyReply;lastPing:number};

export class WaitingRoomEvents {
  private subscriber:Redis|null=null;
  private readonly clients=new Set<Client>();
  private readonly dirty=new Set<number>();
  private timer?:NodeJS.Timeout;
  private inFlight?:Promise<void>;
  constructor(private readonly service:WaitingRoomService) {}
  start() {
    if (this.timer) return;
    if (this.service.redis) {
      this.subscriber=this.service.redis.duplicate();
      this.subscriber.on('error',()=>{}); // connection errors are reflected by SSE fallback, no per-client log
      this.subscriber.on('ready',()=>{void this.subscriber?.subscribe(WAITING_CHANNEL).catch(()=>{}); for(const client of this.clients)this.dirty.add(client.examId);});
      this.subscriber.on('message',(_channel,value)=>{try{this.dirty.add(Number(JSON.parse(value).examId));}catch{/* ignore malformed notifications */}});
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
    const dirty=new Set(this.dirty);this.dirty.clear();
    const pending=[...this.clients];let index=0;
    await Promise.all(Array.from({length:Math.min(32,pending.length)},async()=>{
      while(index<pending.length){
        const client=pending[index++]!;
        if(Date.now()/1000>=client.expires){this.send(client,'expired',{});client.reply.raw.end();this.clients.delete(client);continue;}
        const ping=Date.now()-client.lastPing>=25000;
        if(!dirty.has(client.examId) && !ping)continue;
        try {
          const state=await this.service.status(client.examId,client.studentId);
          this.send(client,'status',this.service.publicView(state,client.examId,client.studentId,client.expires));
          if(ping){client.lastPing=Date.now();client.reply.raw.write(': keepalive\n\n');}
        }catch{this.send(client,'connection',{connected:false});client.reply.raw.end();this.clients.delete(client);}
      }
    }));
  }
  async stop(){if(this.timer)clearInterval(this.timer);this.timer=undefined;for(const c of this.clients)c.reply.raw.end();this.clients.clear();await this.inFlight;this.subscriber?.disconnect();}
}
