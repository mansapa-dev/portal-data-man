import type { FastifyBaseLogger } from 'fastify';
import { WAITING_REGISTRY, waitingBase, type WaitingRoomService } from './waiting-room.js';

export class WaitingRoomWorker {
  private timer?: NodeJS.Timeout;
  private inFlight?: Promise<void>;
  private cursor='0';
  constructor(private readonly service:WaitingRoomService, private readonly log:Pick<FastifyBaseLogger,'warn'>, private readonly tickMs=Number(process.env.WAITING_WORKER_TICK_MS ?? 1000)) {}
  start() {
    if (this.timer) return;
    const tick=()=>{if (!this.inFlight) this.inFlight=this.tick().catch(error=>{this.log.warn({message:error instanceof Error?error.message:'worker failed'},'waiting worker cycle failed');}).finally(()=>{this.inFlight=undefined;});};
    this.timer=setInterval(tick,this.tickMs); this.timer.unref(); tick();
  }
  async stop() { if (this.timer) clearInterval(this.timer); this.timer=undefined; await this.inFlight; }
  async tick() {
    const redis=this.service.redis;
    if (!redis || redis.status!=='ready') return;
    const [cursor,ids]=await redis.sscan(WAITING_REGISTRY,this.cursor,'COUNT',100);
    this.cursor=cursor;
    let index=0;
    await Promise.all(Array.from({length:Math.min(8,ids.length)},async()=>{
      while(index<ids.length) {
        const id=Number(ids[index++]);
        await this.processExam(id);
      }
    }));
  }
  async processExam(id:number){
    const redis=this.service.redis;if(!redis || redis.status!=='ready')return;
    try {
          // One refresh/recovery per queue across all API/worker processes.
          if (await redis.set(`${waitingBase(id)}:refresh`,'1','PX',30000,'NX')) {
            await this.service.configure(id);
            await this.service.reconcile(id);
          }
          await this.service.release(id);
    } catch(error) { this.log.warn({examId:id,message:error instanceof Error?error.message:'queue failed'},'waiting queue cycle failed'); }
  }
}
