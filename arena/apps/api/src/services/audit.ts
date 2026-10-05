import type { Pool } from 'mysql2/promise';
export async function audit(pool: Pool, actorId: number | null, role: string | null, action: string, entity: string, id: string | number, before?: unknown, after?: unknown) {
  await pool.execute('INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data) VALUES(?,?,?,?,?,?,?)', [actorId, role, action, entity, String(id), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)]);
}
