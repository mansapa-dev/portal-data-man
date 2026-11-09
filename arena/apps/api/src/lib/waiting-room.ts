import { pool } from './db.js';
import { redis } from './redis.js';
import { WaitingRoomService } from '../services/waiting-room.js';

export const waitingRoom = new WaitingRoomService(redis,pool);
