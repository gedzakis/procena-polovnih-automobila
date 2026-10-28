const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, '..', 'data', 'autoexpert.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,              -- source:ext_id
  source TEXT NOT NULL,
  brand TEXT, model TEXT, year INTEGER, price INTEGER, mileage INTEGER,
  fuel TEXT, transmission TEXT, engine TEXT, body TEXT, location TEXT,
  image TEXT, link TEXT, checks TEXT DEFAULT '[]',
  risk TEXT, score REAL, market_price INTEGER,
  status TEXT NOT NULL DEFAULT 'active',   -- active | expired
  missed_runs INTEGER NOT NULL DEFAULT 0,
  first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, expired_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status, source);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  price INTEGER NOT NULL, seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ph_listing ON price_history(listing_id);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  phone TEXT, viber_id TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS saved_searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, filters TEXT NOT NULL DEFAULT '{}',
  min_score REAL NOT NULL DEFAULT 9.0,
  channels TEXT NOT NULL DEFAULT '["email"]',
  notify_price_drop INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS notifications (
  search_id INTEGER NOT NULL REFERENCES saved_searches(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, sent_at TEXT NOT NULL,
  PRIMARY KEY (search_id, listing_id, kind)
);

CREATE TABLE IF NOT EXISTS scrape_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT, started_at TEXT, finished_at TEXT,
  found INTEGER, new_count INTEGER, price_changes INTEGER, expired INTEGER, error TEXT
);
`);

// Migracija za postojeće baze: kolone za oglase koje unose korisnici
const cols = db.prepare('PRAGMA table_info(listings)').all().map(c => c.name);
for (const [n, t] of [['owner_id', 'INTEGER'], ['description', 'TEXT'], ['images', "TEXT DEFAULT '[]'"], ['contact_phone', 'TEXT']])
  if (!cols.includes(n)) db.exec(`ALTER TABLE listings ADD COLUMN ${n} ${t}`);
db.exec('CREATE INDEX IF NOT EXISTS idx_listings_owner ON listings(owner_id)');
module.exports = db;
