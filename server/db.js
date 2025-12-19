import Database from 'better-sqlite3'
import path from 'node:path'
import fs from 'node:fs'

const DEFAULT_DB_PATH = path.resolve(process.cwd(), 'data', 'urm.sqlite')

export function getDbPath() {
  return process.env.DB_PATH ? path.resolve(process.cwd(), process.env.DB_PATH) : DEFAULT_DB_PATH
}

export function openDb() {
  const dbPath = getDbPath()
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  return db
}

export function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('requester','reviewer','admin')),
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      why TEXT NOT NULL,
      acceptanceCriteria TEXT,
      status TEXT NOT NULL CHECK (status IN ('Submitted','NeedInfo','Accepted','Suspended','Rejected','Closed')),
      category TEXT,
      priority TEXT,
      tagsJson TEXT NOT NULL,
      linksJson TEXT NOT NULL,
      impactScope TEXT,
      requesterId TEXT NOT NULL,
      reviewerId TEXT,
      decisionReason TEXT,
      suspendUntil TEXT,
      suspendCondition TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (requesterId) REFERENCES users(id),
      FOREIGN KEY (reviewerId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      requestId TEXT NOT NULL,
      authorId TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY (authorId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      requestId TEXT NOT NULL,
      actorId TEXT NOT NULL,
      actionType TEXT NOT NULL CHECK (actionType IN ('status_change','edit','comment','create')),
      fromJson TEXT,
      toJson TEXT,
      note TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (requestId) REFERENCES requests(id) ON DELETE CASCADE,
      FOREIGN KEY (actorId) REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requesterId);
    CREATE INDEX IF NOT EXISTS idx_requests_updatedAt ON requests(updatedAt);
    CREATE INDEX IF NOT EXISTS idx_comments_request ON comments(requestId);
    CREATE INDEX IF NOT EXISTS idx_audit_request ON audit_logs(requestId);
  `)
}

export function toJson(value) {
  return value == null ? null : JSON.stringify(value)
}

export function fromJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

