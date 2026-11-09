export type WaitingState = 'NOT_JOINED'|'WAITING'|'ADMITTED'|'IN_EXAM'|'FINISHED'|'ABANDONED'|'EXPIRED';
export type WaitingView = {
  status:WaitingState;queue_state:'OPEN'|'CLOSED'|'NOT_OPEN'|'ENDED'|'DISABLED';queue_number:number|null;position:number|null;ahead:number|null;
  estimated_wait_seconds?:number;admit_token:string|null;claim_deadline_ms:number|null;
  waiting_count:number;admitted_count:number;in_exam_count:number;finished_count:number;
  batch_size:number;batch_interval_ms:number;heartbeat_timeout_ms:number;claim_timeout_ms:number;queue_open?:number;
  next_batch_at_ms:number;batch_id:number;server_time_ms:number;stream_ticket?:string;released_count?:number;
};
