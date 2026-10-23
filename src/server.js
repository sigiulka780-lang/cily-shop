const path = require('path');
const fs = require('fs');

// Load env early
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------- Database ----------
const dbPath = process.env.DB_PATH || './database/cily.db';
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

let db;

// Initialize database connection
async function initDatabase() {
  db = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });
  
  // Enable WAL mode and foreign keys
  await db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  
  // Initialize tables
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

  // Default plans if empty
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
  }

  // Default settings
  const settings = [
    ['site_name', 'Cily'],
    ['site_description', 'Best CS2 Cheat - Aimbot, ESP, Skin Changer'],
    ['telegram_support', '@CilySupport'],
    ['discord_invite', 'https://discord.gg/cily'],
    ['loader_download_url', '/download/celerity-loader.exe'],
    ['maintenance_mode', 'false'],
    // Manual payment card details (EDIT THESE!)
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
  return db;
}

// Helper functions
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let key = 'CILY-';
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      key += chars[Math.floor(Math.random() * chars.length)];
    }
    if (i < 3) key += '-';
  }
  return key;
}

async function getSetting(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : null;
}

// Make db available globally
function getDb() { return db; }

// ---------- Middleware ----------
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const paymentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many payment attempts' },
});

// ---------- View Engine ----------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---------- Routes ----------

// Home / Landing
app.get('/', async (req, res) => {
  try {
    const plans = await db.all('SELECT * FROM plans WHERE is_active = 1 ORDER BY sort_order');
    const siteName = await getSetting('site_name') || 'Cily';
    const siteDesc = await getSetting('site_description') || '';
    const maintenance = await getSetting('maintenance_mode') === 'true';
    
    res.render('index', { plans, siteName, siteDesc, maintenance });
  } catch (err) {
    console.error('Home route error:', err);
    res.status(500).render('error', { error: err.message });
  }
});

// Create payment
app.post('/api/payment/create', paymentLimiter, async (req, res) => {
  try {
    const { plan_id, email } = req.body;
    
    if (!plan_id || !email) {
      return res.status(400).json({ error: 'Missing plan_id or email' });
    }
    
    const plan = await db.get('SELECT * FROM plans WHERE id = ? AND is_active = 1', plan_id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    if (!email.includes('@')) {
      return res.status(400).json({ error: 'Invalid email' });
    }
    
    // Create pending license
    const licenseKey = generateLicenseKey();
    const now = Date.now();
    const expiresAt = now + plan.duration_days * 24 * 60 * 60 * 1000;
    
    await db.run(`
      INSERT INTO licenses (id, plan_id, status, email, created_at, expires_at)
      VALUES (?, ?, 'pending', ?, ?, ?)
    `, licenseKey, plan_id, email, now, expiresAt);
    
    // Create payment record
    const crypto = require('crypto');
    const paymentId = 'pay_' + crypto.randomBytes(16).toString('hex');
    await db.run(`
      INSERT INTO payments (id, license_id, plan_id, amount_rub, status, email, created_at, metadata)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?)
    `, paymentId, licenseKey, plan_id, plan.price_rub, email, now, JSON.stringify({ plan_name: plan.name }));
    
    // Create YooKassa payment
    const yookassa = require('./services/yookassa');
    const paymentUrl = await yookassa.createPayment({
      amount: plan.price_rub,
      description: `Cily ${plan.name} subscription`,
      email,
      licenseKey,
      paymentId,
      returnUrl: `${process.env.FRONTEND_URL}/payment/success?payment=${paymentId}`,
    });
    
    // Update payment with YooKassa ID
    await db.run('UPDATE payments SET yookassa_id = ? WHERE id = ?', paymentUrl.id, paymentId);
    
    res.json({ paymentUrl: paymentUrl.confirmationUrl, paymentId, licenseKey });
  } catch (err) {
    console.error('Payment create error:', err);
    res.status(500).json({ error: 'Failed to create payment' });
  }
});

// Payment success page
app.get('/payment/success', async (req, res) => {
  try {
    const { payment } = req.query;
    const paymentRecord = await db.get('SELECT * FROM payments WHERE id = ?', payment);
    
    if (!paymentRecord) {
      return res.render('payment-result', { success: false, error: 'Payment not found' });
    }
    
    // Check payment status via YooKassa
    const yookassa = require('./services/yookassa');
    let status = paymentRecord.status;
    
    if (paymentRecord.yookassa_id) {
      const ykPayment = await yookassa.getPayment(paymentRecord.yookassa_id);
      if (ykPayment && ykPayment.status === 'succeeded' && paymentRecord.status !== 'succeeded') {
        await activateLicense(paymentRecord.license_id);
        status = 'succeeded';
      }
    }
    
    const license = await db.get('SELECT * FROM licenses WHERE id = ?', paymentRecord.license_id);
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', paymentRecord.plan_id);
    
    res.render('payment-result', { 
      success: status === 'succeeded', 
      license,
      plan
    });
  } catch (err) {
    console.error('Payment success error:', err);
    res.status(500).render('error', { error: err.message });
  }
});

// Manual payment page
app.get('/payment/manual/:planId', async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await db.get('SELECT * FROM plans WHERE id = ? AND is_active = 1', planId);
    
    if (!plan) {
      return res.status(404).render('404');
    }
    
    // Only allow manual plans
    if (!planId.startsWith('manual_')) {
      return res.redirect('/');
    }
    
    const siteName = await getSetting('site_name') || 'Cily';
    const cardNumber = await getSetting('manual_card_number') || '2200 1234 5678 9012';
    const cardHolder = await getSetting('manual_card_holder') || 'IVAN IVANOV';
    const cardBank = await getSetting('manual_card_bank') || 'Сбербанк';
    
    // Generate unique comment for tracking
    const comment = `CILY-${planId}-${Date.now().toString(36).toUpperCase()}`;
    
    res.render('manual-payment', { 
      plan,
      siteName,
      card: {
        number: cardNumber,
        holder: cardHolder,
        bank: cardBank
      },
      comment
    });
  } catch (err) {
    console.error('Manual payment page error:', err);
    res.status(500).render('error', { error: err.message });
  }
});

// YooKassa webhook
app.post('/webhook/yookassa', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const yookassa = require('./services/yookassa');
    const isValid = yookassa.verifyWebhook(req);
    
    if (!isValid) {
      return res.status(400).send('Invalid signature');
    }
    
    const event = JSON.parse(req.body);
    const payment = event.object;
    
    if (event.event === 'payment.succeeded') {
      const paymentRecord = await db.get('SELECT * FROM payments WHERE yookassa_id = ?', payment.id);
      if (paymentRecord && paymentRecord.status !== 'succeeded') {
        await activateLicense(paymentRecord.license_id);
        await db.run('UPDATE payments SET status = ?, paid_at = ? WHERE id = ?', 'succeeded', Date.now(), paymentRecord.id);
      }
    } else if (event.event === 'payment.canceled') {
      const paymentRecord = await db.get('SELECT * FROM payments WHERE yookassa_id = ?', payment.id);
      if (paymentRecord) {
        await db.run('UPDATE payments SET status = ? WHERE id = ?', 'canceled', paymentRecord.id);
        await db.run('UPDATE licenses SET status = ? WHERE id = ?', 'revoked', paymentRecord.license_id);
      }
    }
    
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).send('Webhook error');
  }
});

// Activate license helper
async function activateLicense(licenseKey) {
  const license = await db.get('SELECT * FROM licenses WHERE id = ?', licenseKey);
  if (!license) return false;
  
  const plan = await db.get('SELECT * FROM plans WHERE id = ?', license.plan_id);
  if (!plan) return false;
  
  // Call license server to create license
  try {
    const licenseServerUrl = process.env.LICENSE_SERVER_URL || 'http://localhost:8443';
    const response = await fetch(`${licenseServerUrl}/admin/license/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LICENSE_SERVER_API_KEY}`,
      },
      body: JSON.stringify({
        key: licenseKey,
        days: plan.duration_days,
        note: `Cily ${plan.name} - ${license.email}`,
      }),
    });
    
    if (!response.ok) {
      console.error('License server error:', await response.text());
    }
  } catch (err) {
    console.error('License server connection error:', err);
  }
  
  await db.run('UPDATE licenses SET status = ? WHERE id = ?', 'active', licenseKey);
  return true;
}

// Download loader (with license check)
app.get('/download/celerity-loader.exe', async (req, res) => {
  try {
    const { key } = req.query;
    
    if (!key) {
      return res.status(400).send('License key required');
    }
    
    const license = await db.get('SELECT * FROM licenses WHERE id = ? AND status = "active"', key);
    if (!license) {
      return res.status(403).send('Invalid or expired license');
    }
    
    // Check if expired
    if (Date.now() > license.expires_at) {
      await db.run('UPDATE licenses SET status = "expired" WHERE id = ?', key);
      return res.status(403).send('License expired');
    }
    
    res.json({
      message: 'Download would start here',
      license: key,
      expires: new Date(license.expires_at).toISOString(),
      downloadUrl: '/files/celerity-loader.exe'
    });
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).send('Server error');
  }
});

// API: Check license status (for loader)
app.get('/api/license/:key/status', async (req, res) => {
  try {
    const { key } = req.params;
    const license = await db.get('SELECT * FROM licenses WHERE id = ?', key);
    
    if (!license) {
      return res.status(404).json({ valid: false, error: 'Not found' });
    }
    
    const now = Date.now();
    const isExpired = now > license.expires_at;
    
    if (isExpired && license.status === 'active') {
      await db.run('UPDATE licenses SET status = "expired" WHERE id = ?', key);
    }
    
    const plan = await db.get('SELECT name FROM plans WHERE id = ?', license.plan_id);
    
    res.json({
      valid: license.status === 'active' && !isExpired,
      status: isExpired ? 'expired' : license.status,
      expiresAt: license.expires_at,
      plan: plan?.name,
      hwidBound: !!license.hwid,
    });
  } catch (err) {
    console.error('License status error:', err);
    res.status(500).json({ valid: false, error: 'Server error' });
  }
});

// Admin panel (simple auth)
function adminAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) {
    res.set('WWW-Authenticate', 'Basic realm="Admin"');
    return res.status(401).send('Authentication required');
  }
  
  const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
  const expectedPassHash = process.env.ADMIN_PASSWORD_HASH;
  
  if (user !== process.env.ADMIN_USERNAME || !expectedPassHash) {
    return res.status(401).send('Invalid credentials');
  }
  
  const passHash = require('crypto').createHash('sha256').update(pass).digest('hex');
  if (passHash !== expectedPassHash) {
    return res.status(401).send('Invalid credentials');
  }
  
  next();
}

app.get('/admin', adminAuth, async (req, res) => {
  try {
    const stats = {
      totalLicenses: (await db.get('SELECT COUNT(*) as c FROM licenses')).c,
      activeLicenses: (await db.get('SELECT COUNT(*) as c FROM licenses WHERE status = "active"')).c,
      expiredLicenses: (await db.get('SELECT COUNT(*) as c FROM licenses WHERE status = "expired"')).c,
      bannedLicenses: (await db.get('SELECT COUNT(*) as c FROM licenses WHERE status = "banned"')).c,
      totalRevenue: (await db.get('SELECT COALESCE(SUM(amount_rub), 0) as sum FROM payments WHERE status = "succeeded"')).sum,
      pendingPayments: (await db.get('SELECT COUNT(*) as c FROM payments WHERE status = "pending"')).c,
    };
    
    const recentLicenses = await db.all(`
      SELECT l.*, p.name as plan_name 
      FROM licenses l 
      LEFT JOIN plans p ON l.plan_id = p.id 
      ORDER BY l.created_at DESC 
      LIMIT 50
    `);
    
    const recentPayments = await db.all('SELECT * FROM payments ORDER BY created_at DESC LIMIT 50');
    
    res.render('admin', { stats, recentLicenses, recentPayments });
  } catch (err) {
    console.error('Admin error:', err);
    res.status(500).render('error', { error: err.message });
  }
});

// Admin: Ban/Unban license
app.post('/admin/license/:key/ban', adminAuth, async (req, res) => {
  const { key } = req.params;
  await db.run('UPDATE licenses SET status = "banned" WHERE id = ?', key);
  res.json({ success: true });
});

app.post('/admin/license/:key/unban', adminAuth, async (req, res) => {
  const { key } = req.params;
  await db.run('UPDATE licenses SET status = "active" WHERE id = ?', key);
  res.json({ success: true });
});

app.post('/admin/license/:key/reset-hwid', adminAuth, async (req, res) => {
  const { key } = req.params;
  await db.run('UPDATE licenses SET hwid = NULL WHERE id = ?', key);
  res.json({ success: true });
});

app.post('/admin/license/:key/extend', adminAuth, async (req, res) => {
  const { key } = req.params;
  const { days } = req.body;
  const license = await db.get('SELECT * FROM licenses WHERE id = ?', key);
  if (!license) return res.status(404).json({ error: 'Not found' });
  
  const newExpiry = Math.max(license.expires_at, Date.now()) + days * 24 * 60 * 60 * 1000;
  await db.run('UPDATE licenses SET expires_at = ?, status = "active" WHERE id = ?', newExpiry, key);
  res.json({ success: true, expiresAt: newExpiry });
});

// Admin: Create license manually (for manual payments)
app.post('/admin/license/create', adminAuth, async (req, res) => {
  try {
    const { plan_id, email, days } = req.body;
    
    if (!plan_id || !email) {
      return res.status(400).json({ error: 'Missing plan_id or email' });
    }
    
    const plan = await db.get('SELECT * FROM plans WHERE id = ?', plan_id);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    const licenseKey = generateLicenseKey();
    const now = Date.now();
    const durationDays = days || plan.duration_days;
    const expiresAt = now + durationDays * 24 * 60 * 60 * 1000;
    
    await db.run(`
      INSERT INTO licenses (id, plan_id, status, email, created_at, expires_at)
      VALUES (?, ?, 'active', ?, ?, ?)
    `, licenseKey, plan_id, email, now, expiresAt);
    
    // Create payment record for tracking
    const crypto = require('crypto');
    const paymentId = 'pay_manual_' + crypto.randomBytes(8).toString('hex');
    await db.run(`
      INSERT INTO payments (id, license_id, plan_id, amount_rub, status, email, payment_method, created_at, paid_at, metadata)
      VALUES (?, ?, ?, ?, 'succeeded', ?, 'manual', ?, ?, ?)
    `, paymentId, licenseKey, plan_id, plan.price_rub, email, now, now, JSON.stringify({ manual: true, admin_created: true }));
    
    // Notify license server
    try {
      const licenseServerUrl = process.env.LICENSE_SERVER_URL || 'http://localhost:8443';
      await fetch(`${licenseServerUrl}/admin/license/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.LICENSE_SERVER_API_KEY}`,
        },
        body: JSON.stringify({
          key: licenseKey,
          days: durationDays,
          note: `Cily ${plan.name} (manual) - ${email}`,
        }),
      });
    } catch (err) {
      console.error('License server error:', err);
    }
    
    res.json({ 
      success: true, 
      licenseKey,
      expiresAt,
      plan: plan.name
    });
  } catch (err) {
    console.error('Manual license create error:', err);
    res.status(500).json({ error: 'Failed to create license' });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

// 404
app.use((req, res) => {
  res.status(404).render('404');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).render('error', { error: err.message });
});

// Start server after DB init
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Cily Shop running on http://localhost:${PORT}`);
    console.log(`Admin panel: http://localhost:${PORT}/admin`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

module.exports = app;