import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  PendingEvent,
  PendingEventPayload,
  PendingEventStatus,
  PendingEventType,
  Snapshot,
  UndoData,
} from './types.js';

// node:sqlite é nativo do Node (estável a partir da v23.4, experimental antes disso —
// por isso o script "dev"/"start" sempre passa --experimental-sqlite). Zero build nativo,
// diferente de better-sqlite3, que exige toolchain de C++ pra compilar no Windows/Docker.
const DB_PATH = process.env.DB_PATH || './data/events.sqlite';

mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    applied_at TEXT,
    undo_json TEXT
  );

  CREATE TABLE IF NOT EXISTS app_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Bancos criados antes da Fase 4 não têm undo_json; ALTER falha se a coluna já existir.
try {
  db.exec('ALTER TABLE events ADD COLUMN undo_json TEXT');
} catch {
  // Coluna já existe — nada a fazer.
}

interface EventRow {
  id: number;
  type: PendingEventType;
  payload_json: string;
  status: PendingEventStatus;
  created_at: string;
  applied_at: string | null;
  undo_json: string | null;
}

const toEvent = (row: EventRow): PendingEvent => ({
  id: row.id,
  type: row.type,
  payload: JSON.parse(row.payload_json) as PendingEventPayload,
  status: row.status,
  createdAt: row.created_at,
  appliedAt: row.applied_at,
  undo: row.undo_json ? (JSON.parse(row.undo_json) as UndoData) : null,
});

export const insertEvent = (type: PendingEventType, payload: PendingEventPayload): PendingEvent => {
  const stmt = db.prepare('INSERT INTO events (type, payload_json) VALUES (?, ?)');
  const info = stmt.run(type, JSON.stringify(payload));
  return getEvent(Number(info.lastInsertRowid))!;
};

export const getEvent = (id: number): PendingEvent | undefined => {
  const row = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as EventRow | undefined;
  return row ? toEvent(row) : undefined;
};

export const getPendingEvents = (): PendingEvent[] => {
  const rows = db.prepare("SELECT * FROM events WHERE status = 'pending' ORDER BY id ASC").all() as unknown as EventRow[];
  return rows.map(toEvent);
};

export const markEventsApplied = (ids: number[]): void => {
  if (!ids.length) return;
  const stmt = db.prepare("UPDATE events SET status = 'applied', applied_at = datetime('now') WHERE id = ?");
  ids.forEach(id => stmt.run(id));
};

export const markEventFailed = (id: number): void => {
  db.prepare("UPDATE events SET status = 'failed', applied_at = datetime('now') WHERE id = ?").run(id);
};

export const setEventUndo = (id: number, undo: UndoData | null): void => {
  db.prepare('UPDATE events SET undo_json = ? WHERE id = ?').run(undo ? JSON.stringify(undo) : null, id);
};

/** Último evento ainda na fila — pode ser cancelado sem envolver o app. */
export const getLastPendingEvent = (): PendingEvent | undefined => {
  const row = db.prepare("SELECT * FROM events WHERE status = 'pending' ORDER BY id DESC LIMIT 1").get() as unknown as EventRow | undefined;
  return row ? toEvent(row) : undefined;
};

/** Último evento já aplicado que sabemos reverter. */
export const getLastUndoableEvent = (): PendingEvent | undefined => {
  const row = db.prepare(
    "SELECT * FROM events WHERE status = 'applied' AND undo_json IS NOT NULL AND type != 'desfazer' ORDER BY id DESC LIMIT 1",
  ).get() as unknown as EventRow | undefined;
  return row ? toEvent(row) : undefined;
};

export const deleteEvent = (id: number): void => {
  db.prepare('DELETE FROM events WHERE id = ?').run(id);
};

// ─── Estado auxiliar (snapshot, controle de lembrete) ─────────────────────────

const setState = (key: string, value: string) => {
  db.prepare(
    "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, datetime('now')) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')",
  ).run(key, value);
};

const getState = (key: string): string | undefined => {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as unknown as { value: string } | undefined;
  return row?.value;
};

export const saveSnapshot = (snapshot: Snapshot): void => setState('snapshot', JSON.stringify(snapshot));

export const getSnapshot = (): Snapshot | undefined => {
  const raw = getState('snapshot');
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Snapshot;
  } catch {
    return undefined;
  }
};

export const getLastReminderDate = (): string | undefined => getState('last_reminder_date');
export const setLastReminderDate = (date: string): void => setState('last_reminder_date', date);
