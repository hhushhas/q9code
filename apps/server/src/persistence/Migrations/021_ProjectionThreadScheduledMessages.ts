import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Effect from "effect/Effect";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS projection_thread_scheduled_messages (
      scheduled_message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      content TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      target_json TEXT NOT NULL,
      delivery_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      delivered_at TEXT,
      cancelled_at TEXT,
      failed_at TEXT,
      failure_reason TEXT,
      delayed_due_to_recovery INTEGER NOT NULL DEFAULT 0
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_scheduled_messages_thread_created
    ON projection_thread_scheduled_messages(thread_id, created_at, scheduled_message_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_thread_scheduled_messages_pending_schedule
    ON projection_thread_scheduled_messages(status, scheduled_for, thread_id)
  `;
});
