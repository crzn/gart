import { randomId } from "../security/tokens";

export async function writeAudit(
  db: D1Database,
  entry: { adminId: string | null; action: string; entity?: string; entityId?: string; meta?: Record<string, unknown> },
): Promise<void> {
  await db
    .prepare("INSERT INTO audit_logs (id, admin_id, action, entity, entity_id, meta_json) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(randomId(), entry.adminId, entry.action, entry.entity ?? "", entry.entityId ?? "", JSON.stringify(entry.meta ?? {}))
    .run();
}
