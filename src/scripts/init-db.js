const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const dbPath = process.env.DB_PATH || './database/cily.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

async function initDB() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  await db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  
  console.log('[DB] Initializing database at:', dbPath);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      duration_days INTEGER NOT NULL,
      price_rub INTEGER NOT NULL,
      features TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS licenses (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      hwid TEXT,
      email TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_heartbeat INTEGER,
      ip_last TEXT,
      FOREIGN KEY (plan_id) REFERENCES plans(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      license_id TEXT,
      plan_id TEXT NOT NULL,
      amount_rub INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      email TEXT,
      payment_method TEXT,
      yookassa_id TEXT UNIQUE,
      created_at INTEGER NOT NULL,
      paid_at INTEGER,
      metadata TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_licenses_email ON licenses(email);
    CREATE INDEX IF NOT EXISTS idx_licenses_status ON licenses(status);
    CREATE INDEX IF NOT EXISTS idx_payments_yookassa ON payments(yookassa_id);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
  `);

  const count = await db.get('SELECT COUNT(*) as c FROM plans');
  if (count.c === 0) {
    const plans = [
      ['week', 'Неделя', 7, 499, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Support']), 1],
      ['month', 'Месяц', 30, 1499, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Priority Support', 'Config Cloud Sync']), 2],
      ['quarter', '3 Месяца', 90, 3999, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Priority Support', 'Config Cloud Sync', 'Early Access Features', 'Discord VIP']), 3],
      ['manual_week', 'Неделя (ручная оплата)', 7, 499, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Support']), 4],
      ['manual_month', 'Месяц (ручная оплата)', 30, 1499, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Priority Support', 'Config Cloud Sync']), 5],
      ['manual_quarter', '3 Месяца (ручная оплата)', 90, 3999, JSON.stringify(['Aimbot', 'Triggerbot', 'Bhop', 'ESP', 'Skin Changer', 'HWID Lock', 'Priority Support', 'Config Cloud Sync', 'Early Access Features', 'Discord VIP']), 6],
    ];
    for (const p of plans) {
      await db.run(`
        INSERT INTO plans (id, name, duration_days, price_rub, features, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `, ...p);
    }
    console.log('[DB] Default plans inserted');
  }

  const settings = [
    ['site_name', 'Cily'],
    ['site_description', 'Best CS2 Cheat - Aimbot, ESP, Skin Changer'],
    ['telegram_support', '@CilySupport'],
    ['discord_invite', 'https://discord.gg/cily'],
    ['loader_download_url', '/download/celerity-loader.exe'],
    ['maintenance_mode', 'false'],
    // Manual payment card details (CHANGE THESE!)
    ['manual_card_number', '2200 1234 5678 9012'],
    ['manual_card_holder', 'IVAN IVANOV'],
    ['manual_card_bank', 'Сбербанк'],
  ];
  for (const [k, v] of settings) {
    await db.run(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value
    `, k, v);
  }

  console.log('[DB] Database initialized successfully');
  await db.close();
}

initDB().catch(err => {
  console.error('[DB] Error:', err);
  process.exit(1);
});