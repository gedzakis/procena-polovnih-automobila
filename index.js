require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const jobs = require('./jobs');

const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.startsWith('promeni')) { console.error('Postavi JWT_SECRET u .env (kopiraj .env.example).'); process.exit(1); }

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false })); // CSP isključen jer front koristi CDN-ove (Tailwind, Chart.js)
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'data', 'uploads'), { maxAge: '7d', setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const ok = (res, data) => res.json(data);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });

// ---------- Auth ----------
const sign = u => jwt.sign({ uid: u.id }, SECRET, { expiresIn: '30d' });
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.uid = jwt.verify(t, SECRET).uid; next(); } catch { bad(res, 'Prijavite se.', 401); }
}
const publicUser = u => ({ id: u.id, email: u.email, phone: u.phone, viber_id: u.viber_id });

app.post('/api/auth/register', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  if (!/^\S+@\S+\.\S+$/.test(email || '')) return bad(res, 'Neispravan email.');
  if (!password || password.length < 8) return bad(res, 'Lozinka mora imati bar 8 karaktera.');
  try {
    const r = db.prepare('INSERT INTO users (email, pass_hash, created_at) VALUES (?,?,?)')
      .run(email.toLowerCase(), bcrypt.hashSync(password, 11), new Date().toISOString());
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(r.lastInsertRowid);
    ok(res, { token: sign(u), user: publicUser(u) });
  } catch { bad(res, 'Nalog sa tim emailom već postoji.', 409); }
});

app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(password || '', u.pass_hash)) return bad(res, 'Pogrešan email ili lozinka.', 401);
  ok(res, { token: sign(u), user: publicUser(u) });
});

app.get('/api/me', auth, (req, res) => ok(res, publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.uid))));
app.patch('/api/me', auth, (req, res) => {
  const phone = String(req.body.phone || '').trim() || null;
  const viber = String(req.body.viber_id || '').trim() || null;
  if (phone && !/^\+\d{8,15}$/.test(phone)) return bad(res, 'Telefon mora biti u formatu +381641234567.');
  db.prepare('UPDATE users SET phone=?, viber_id=? WHERE id=?').run(phone, viber, req.uid);
  ok(res, publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.uid)));
});

// ---------- Oglasi ----------
const esc = v => typeof v === 'string' ? v.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) : v;
// Front ubacuje ove vrednosti u innerHTML, pa se SVE tekstualno što stiže od korisnika/scrapera escape-uje ovde.
const toCar = r => ({
  id: r.id, brand: esc(r.brand), model: esc(r.model), year: r.year, price: r.price, marketPrice: r.market_price,
  mileage: r.mileage, fuel: esc(r.fuel), transmission: esc(r.transmission), engine: esc(r.engine) || '—', body: esc(r.body) || '—',
  location: esc(r.location), score: r.score, risk: r.risk, image: esc(r.image), link: esc(r.link),
  checks: JSON.parse(r.checks || '[]').map(esc), firstSeen: r.first_seen,
  isUser: r.source === 'user', description: esc(r.description || ''), contactPhone: esc(r.contact_phone || ''),
  firstPrice: r.first_price ?? r.price,
});

app.get('/api/listings', (req, res) => {
  const rows = db.prepare(`SELECT l.*, (SELECT price FROM price_history WHERE listing_id=l.id ORDER BY id LIMIT 1) AS first_price
    FROM listings l WHERE status='active' ORDER BY score DESC LIMIT 2000`).all();
  ok(res, rows.map(toCar));
});

app.get('/api/listings/:id/history', (req, res) => {
  ok(res, db.prepare('SELECT price, seen_at AS at FROM price_history WHERE listing_id=? ORDER BY id').all(req.params.id));
});

app.get('/api/stats', (req, res) => {
  const active = db.prepare(`SELECT COUNT(*) n FROM listings WHERE status='active'`).get().n;
  const last = db.prepare(`SELECT finished_at, error FROM scrape_runs ORDER BY id DESC LIMIT 1`).get();
  ok(res, { active, lastRun: last?.finished_at || null, lastError: last?.error || null });
});

// ---------- Sačuvane pretrage / obaveštenja ----------
const fmt = s => ({ id: s.id, name: s.name, filters: JSON.parse(s.filters), minScore: s.min_score,
  channels: JSON.parse(s.channels), notifyPriceDrop: !!s.notify_price_drop, active: !!s.active });

app.get('/api/searches', auth, (req, res) =>
  ok(res, db.prepare('SELECT * FROM saved_searches WHERE user_id=? ORDER BY id DESC').all(req.uid).map(fmt)));

app.post('/api/searches', auth, (req, res) => {
  const b = req.body || {};
  const channels = (Array.isArray(b.channels) ? b.channels : ['email']).filter(c => ['email', 'sms', 'viber'].includes(c));
  const minScore = Math.max(1, Math.min(10, Number(b.minScore) || 9));
  const count = db.prepare('SELECT COUNT(*) n FROM saved_searches WHERE user_id=?').get(req.uid).n;
  if (count >= 20) return bad(res, 'Maksimalno 20 sačuvanih pretraga.');
  const r = db.prepare(`INSERT INTO saved_searches (user_id,name,filters,min_score,channels,notify_price_drop,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(req.uid, String(b.name || 'Moja pretraga').slice(0, 80), JSON.stringify(b.filters || {}), minScore,
      JSON.stringify(channels.length ? channels : ['email']), b.notifyPriceDrop === false ? 0 : 1, new Date().toISOString());
  ok(res, fmt(db.prepare('SELECT * FROM saved_searches WHERE id=?').get(r.lastInsertRowid)));
});

app.patch('/api/searches/:id', auth, (req, res) => {
  const r = db.prepare('UPDATE saved_searches SET active=? WHERE id=? AND user_id=?').run(req.body.active ? 1 : 0, req.params.id, req.uid);
  r.changes ? ok(res, { ok: true }) : bad(res, 'Nije pronađeno.', 404);
});
app.delete('/api/searches/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM saved_searches WHERE id=? AND user_id=?').run(req.params.id, req.uid);
  r.changes ? ok(res, { ok: true }) : bad(res, 'Nije pronađeno.', 404);
});

// ---------- Vlastiti oglasi ----------
app.use('/api/my', auth, require('./own')({ toCar }));

// ---------- Admin ----------
app.delete('/api/admin/listings/:id', (req, res) => {   // moderacija: ukloni sporan oglas
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return bad(res, 'Zabranjeno.', 403);
  const r = db.prepare('DELETE FROM listings WHERE id=?').run(req.params.id);
  r.changes ? ok(res, { ok: true }) : bad(res, 'Nije pronađeno.', 404);
});
app.post('/api/admin/run', async (req, res) => {
  if (!process.env.ADMIN_KEY || req.headers['x-admin-key'] !== process.env.ADMIN_KEY) return bad(res, 'Zabranjeno.', 403);
  ok(res, await jobs.runOnce());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`AutoExpert Live na http://localhost:${PORT}`); jobs.start(); });
