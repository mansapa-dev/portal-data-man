import { pool } from './lib/db.js';
import { redis } from './lib/redis.js';
import { waitingRoom } from './lib/waiting-room.js';
import { WaitingRoomWorker } from './services/waiting-room-worker.js';
import Fastify from 'fastify';

const app=Fastify({logger:{level:process.env.LOG_LEVEL ?? 'warn'}});
const worker=new WaitingRoomWorker(waitingRoom,app.log);
worker.start();
const keepAlive=setInterval(()=>{},60000);
const stop=async()=>{clearInterval(keepAlive);await worker.stop();await app.close();await pool?.end();redis?.disconnect();};
process.once('SIGINT',()=>{void stop();});process.once('SIGTERM',()=>{void stop();});
