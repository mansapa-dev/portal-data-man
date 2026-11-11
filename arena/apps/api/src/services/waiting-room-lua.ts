// Redis serializes this entire operation. FIFO uses Redis TIME plus a globally
// increasing per-exam sequence as lexicographic tie-breaker, never client time.
export const waitingRoomLua = `
redis.replicate_commands()
local t = redis.call('TIME')
local now = tonumber(t[1])*1000 + math.floor(tonumber(t[2])/1000)
local op, sid, data = ARGV[1], ARGV[2], cjson.decode(ARGV[3])
local base = ARGV[4]
local meta, queue, hb, admitted, sequence, counts = KEYS[1], KEYS[2], KEYS[3], KEYS[4], KEYS[5], KEYS[6]
local changed = false
local function key(id) return base..':student:'..id end
local function number(field, default) return tonumber(redis.call('HGET',meta,field)) or default end
local function retain(k)
  redis.call('PEXPIREAT', k, math.max(now,number('ends_at_ms',now)) + number('retention_ms',172800000))
end
if op == 'configure' then
  for field,value in pairs(data) do redis.call('HSET',meta,field,tostring(value)) end
  local last = number('last_batch_at_ms',0)
  if last > 0 then redis.call('HSET',meta,'next_batch_at_ms',last+number('batch_interval_ms',10000)) end
  retain(meta)
  changed = true
end
if redis.call('EXISTS',meta)==0 then return cjson.encode({error='QUEUE_NOT_READY'}) end
local function availability()
  if redis.call('HGET',meta,'exam_status') ~= 'ACTIVE' then return 'DISABLED' end
  if now < number('starts_at_ms',0) then return 'NOT_OPEN' end
  if now > number('ends_at_ms',0) then return 'ENDED' end
  if number('queue_open',1) ~= 1 then return 'CLOSED' end
  return 'OPEN'
end
local function expire(id)
  local sk = key(id)
  local state = redis.call('HGET',sk,'status')
  if state == 'WAITING' and tonumber(redis.call('HGET',sk,'heartbeat_until_ms') or '0') <= now then
    local member = redis.call('HGET',sk,'member')
    if member then redis.call('ZREM',queue,member) end
    redis.call('ZREM',hb,id)
    redis.call('HSET',sk,'status','ABANDONED')
    changed = true
  elseif state == 'ADMITTED' and tonumber(redis.call('HGET',sk,'claim_deadline_ms') or '0') <= now then
    local lease = tonumber(redis.call('HGET',sk,'claim_lease_until_ms') or '0')
    if lease > now then redis.call('ZADD',admitted,lease,id)
    else
      redis.call('HSET',sk,'status','EXPIRED')
      redis.call('HDEL',sk,'token','claim_owner','claim_lease_until_ms')
      redis.call('ZREM',admitted,id)
      changed = true
    end
  end
end
local released = {}
if op == 'release' or op == 'sweep' then
  for _,id in ipairs(redis.call('ZRANGEBYSCORE',hb,'-inf',now,'LIMIT',0,1000)) do expire(id) end
  for _,id in ipairs(redis.call('ZRANGEBYSCORE',admitted,'-inf',now,'LIMIT',0,1000)) do expire(id) end
else expire(sid) end
local sk = key(sid)
local state = redis.call('HGET',sk,'status')
if op == 'join' then
  if not state or ((state=='ABANDONED' or state=='EXPIRED') and data.rejoin==true) then
    if availability() ~= 'OPEN' then return cjson.encode({error='QUEUE_'..availability()}) end
    local seq = redis.call('INCR',sequence)
    local member = string.format('%016d',seq)..':'..sid
    local score = math.max(now,number('last_join_at_ms',now))
    redis.call('HSET',meta,'last_join_at_ms',score)
    redis.call('HSETNX',meta,'next_batch_at_ms',now+number('batch_interval_ms',10000))
    redis.call('HSET',sk,'status','WAITING','sequence',seq,'member',member,'joined_at_ms',now,'heartbeat_until_ms',now+number('heartbeat_timeout_ms',90000))
    redis.call('HDEL',sk,'token','claim_owner','claim_lease_until_ms','claim_deadline_ms','attempt_id')
    redis.call('ZADD',queue,score,member)
    redis.call('ZADD',hb,now+number('heartbeat_timeout_ms',90000),sid)
    changed = true
  elseif state=='WAITING' then
    redis.call('HSET',sk,'heartbeat_until_ms',now+number('heartbeat_timeout_ms',90000))
    redis.call('ZADD',hb,now+number('heartbeat_timeout_ms',90000),sid)
  end
  retain(sk)
elseif op == 'heartbeat' and state=='WAITING' then
  redis.call('HSET',sk,'heartbeat_until_ms',now+number('heartbeat_timeout_ms',90000))
  redis.call('ZADD',hb,now+number('heartbeat_timeout_ms',90000),sid)
elseif op == 'leave' then
  if state=='WAITING' then
    local member = redis.call('HGET',sk,'member')
    if member then redis.call('ZREM',queue,member) end
    redis.call('ZREM',hb,sid)
    redis.call('HSET',sk,'status','ABANDONED')
    changed = true
  elseif state=='ADMITTED' and tonumber(redis.call('HGET',sk,'claim_lease_until_ms') or '0')<=now then
    redis.call('HSET',sk,'status','EXPIRED')
    redis.call('HDEL',sk,'token')
    redis.call('ZREM',admitted,sid)
    changed = true
  end
elseif op == 'claim_begin' then
  if not state or redis.call('HGET',sk,'token')~=data.token then return cjson.encode({error='ADMIT_TOKEN_INVALID'}) end
  if state~='ADMITTED' and state~='IN_EXAM' then return cjson.encode({error='ADMIT_REQUIRED'}) end
  if state=='ADMITTED' then
    if availability()~='OPEN' and availability()~='CLOSED' then return cjson.encode({error='QUEUE_'..availability()}) end
    local owner = redis.call('HGET',sk,'claim_owner')
    if owner and owner~=data.owner and tonumber(redis.call('HGET',sk,'claim_lease_until_ms') or '0')>now then return cjson.encode({error='CLAIM_BUSY'}) end
    redis.call('HSET',sk,'claim_owner',data.owner,'claim_lease_until_ms',now+60000)
    redis.call('ZADD',admitted,math.max(now+60000,tonumber(redis.call('HGET',sk,'claim_deadline_ms'))),sid)
  end
elseif op == 'claim_abort' then
  if state=='ADMITTED' and redis.call('HGET',sk,'claim_owner')==data.owner then
    redis.call('HDEL',sk,'claim_owner','claim_lease_until_ms')
    redis.call('ZADD',admitted,tonumber(redis.call('HGET',sk,'claim_deadline_ms') or '0'),sid)
    expire(sid)
  end
elseif op == 'restore' then
  local old = state
  local member = redis.call('HGET',sk,'member')
  if member then redis.call('ZREM',queue,member) end
  redis.call('ZREM',hb,sid)
  redis.call('ZREM',admitted,sid)
  if old=='IN_EXAM' then redis.call('HINCRBY',counts,'in_exam',-1) end
  if old=='FINISHED' then redis.call('HINCRBY',counts,'finished',-1) end
  redis.call('HSET',sk,'status',data.status,'token',data.token,'attempt_id',data.attempt_id)
  redis.call('HDEL',sk,'claim_owner','claim_lease_until_ms')
  if data.status=='IN_EXAM' then redis.call('HINCRBY',counts,'in_exam',1) else redis.call('HINCRBY',counts,'finished',1) end
  retain(sk)
  changed = true
elseif op == 'finish' then
  if state=='IN_EXAM' then
    redis.call('HSET',sk,'status','FINISHED')
    redis.call('HINCRBY',counts,'in_exam',-1)
    redis.call('HINCRBY',counts,'finished',1)
    changed = true
  end
elseif op == 'guard' then
  if not data.token or redis.call('HGET',sk,'token')~=data.token then return cjson.encode({error='ADMIT_TOKEN_INVALID'}) end
  if state~='IN_EXAM' and not (data.finished==true and state=='FINISHED') then return cjson.encode({error='ADMIT_REQUIRED'}) end
  -- Autosave/heartbeat only need authorization, not the queue dashboard.
  return cjson.encode({status=state})
end
if op=='release' and availability()=='OPEN' then
  local due = now>=number('next_batch_at_ms',now+1)
  local initialManual = data.manual==true and number('batch_id',0)==0 and number('next_batch_at_ms',0)>0
  if (due or initialManual) and (not data.expected_batch or data.expected_batch==number('batch_id',0)) then
    local size = number('batch_size',300)
    local capacity = math.max(0,size-redis.call('ZCARD',admitted))
    for _,member in ipairs(redis.call('ZRANGE',queue,0,size+1000-1)) do
      if #released>=capacity then break end
      local id = string.match(member,':(%d+)$')
      expire(id)
      local student = key(id)
      if redis.call('HGET',student,'status')=='WAITING' then
        local seq = redis.call('HGET',student,'sequence')
        local token = redis.sha1hex(data.seed..':'..id..':'..seq)
        redis.call('HSET',student,'status','ADMITTED','token',token,'admitted_at_ms',now,'claim_deadline_ms',now+number('claim_timeout_ms',60000))
        redis.call('ZREM',queue,member)
        redis.call('ZREM',hb,id)
        redis.call('ZADD',admitted,now+number('claim_timeout_ms',60000),id)
        table.insert(released,id)
        changed = true
      end
    end
    if #released>0 then
      redis.call('HINCRBY',meta,'batch_id',1)
      redis.call('HSET',meta,'last_batch_at_ms',now,'next_batch_at_ms',now+number('batch_interval_ms',10000))
    end
  end
end
if changed then redis.call('HINCRBY',meta,'version',1) end
for _,k in ipairs(KEYS) do if redis.call('EXISTS',k)==1 then retain(k) end end
state = redis.call('HGET',sk,'status') or 'NOT_JOINED'
local rank = false
local member = redis.call('HGET',sk,'member')
if state=='WAITING' and member then rank=redis.call('ZRANK',queue,member) end
local result = {
  status=state, queue_state=availability(), queue_number=tonumber(redis.call('HGET',sk,'sequence')) or cjson.null,
  position=rank and rank+1 or cjson.null, ahead=rank or cjson.null,
  joined_at_ms=tonumber(redis.call('HGET',sk,'joined_at_ms')) or cjson.null,
  admit_token=(state=='ADMITTED' or state=='IN_EXAM' or state=='FINISHED') and (redis.call('HGET',sk,'token') or cjson.null) or cjson.null,
  claim_deadline_ms=state=='ADMITTED' and (tonumber(redis.call('HGET',sk,'claim_deadline_ms')) or cjson.null) or cjson.null,
  waiting_count=redis.call('ZCARD',queue), admitted_count=redis.call('ZCARD',admitted),
  in_exam_count=tonumber(redis.call('HGET',counts,'in_exam') or '0'), finished_count=tonumber(redis.call('HGET',counts,'finished') or '0'), queue_open=number('queue_open',1),
  batch_size=number('batch_size',300), batch_interval_ms=number('batch_interval_ms',10000),
  heartbeat_timeout_ms=number('heartbeat_timeout_ms',90000), claim_timeout_ms=number('claim_timeout_ms',60000),
  next_batch_at_ms=number('next_batch_at_ms',0), batch_id=number('batch_id',0), server_time_ms=now,
  version=number('version',0), changed=changed, released=released
}
if rank then result.estimated_wait_seconds=math.ceil((math.max(0,result.next_batch_at_ms-now)+math.floor(rank/result.batch_size)*result.batch_interval_ms)/1000) end
return cjson.encode(result)
`;
