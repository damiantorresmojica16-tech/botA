const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const fs   = require("fs");

const DATA_DIR = process.env.RENDER_DISK_PATH || path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "widman.db");
let _db = null;

function getDb() {
  if (!_db) {
    _db = new DatabaseSync(DB_PATH);
    initSchema(_db);
  }
  return _db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      banned INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key_value TEXT NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      device_id TEXT,
      active_session_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(created_by) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS bot_sessions (
      telegram_id INTEGER PRIMARY KEY,
      state TEXT NOT NULL DEFAULT 'idle',
      user_id INTEGER,
      temp_data TEXT
    );
  `);
  const owner = db.prepare("SELECT id FROM users WHERE role = 'owner'").get();
  if (!owner) {
    db.prepare("INSERT OR IGNORE INTO users (username, password, role) VALUES ('liam', '23', 'owner')").run();
  }
}

module.exports = { getDb };
