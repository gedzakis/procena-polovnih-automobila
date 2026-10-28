// Oglasi koje unose korisnici/prodavci: kreiranje, izmena cene (istorija), prodato, obnova, brisanje.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const express = require('express'), multer = require('multer'), rateLimit = require('express-rate-limit');
const db = require('./db');
const { rescoreAll } = require('./scoring');
const { runAlerts } = require('./alerts');

const UPLOADS = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const MAX_ACTIVE = Number(process.env.MAX_ACTIVE_USER_LISTINGS || 10);
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOADS, filename: (q, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + EXT[f.mimetype]) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (q, f, cb) => cb(EXT[f.mimetype] ? null : new Error('Dozvoljene su samo JPG, PNG i WEBP slike.'), !!EXT[f.mimetype]),
}).array('images', 6);

const FUELS = ['Dizel', 'Benzin', 'Hibrid', 'Električni'], GEARS = ['Automatski', 'Manuelni'];
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const rmFiles = imgs => JSON.parse(imgs || '[]').forEach(u => fs.unlink(path.join(UPLOADS, path.basename(u)), () => {}));

module.exports = ({ toCar }) => {
  const r = express.Router();
  const bad = (res, m, c = 400) => res.status(c).json({ error: m });
  const mine = (id, uid) => db.prepare('SELECT * FROM listings WHERE id=? AND owner_id=?').get(id, uid);
  const after = () => { rescoreAll(db); runAlerts().catch(e => console.error('alerts:', e.message)); };

  r.get('/listings', (req, res) => res.json(db.prepare('SELECT * FROM listings WHERE owner_id=? ORDER BY first_seen DESC').all(req.uid)
    .map(l => ({ ...toCar(l), status: l.status, lastSeen: l.last_seen }))));

  r.post('/listings', rateLimit({ windowMs: 60 * 60 * 1000, max: 20 }), (req, res) => {
    upload(req, res, err => {
      const files = req.files || [];
      const fail = (m, c) => { files.forEach(f => fs.unlink(f.path, () => {})); bad(res, m, c); };
      if (err) return fail(err.message);
      const b = req.body, year = parseInt(b.year), price = parseInt(b.price), km = parseInt(b.mileage);
      const brand = str(b.brand, 40), model = str(b.model, 80), phone = str(b.contactPhone, 20);
      if (!brand || !model) return fail('Marka i model su obavezni.');
      if (!(year >= 1960 && year <= new Date().getFullYear() + 1)) return fail('Neispravno godište.');
      if (!(price >= 100 && price <= 2000000)) return fail('Cena mora biti između 100 i 2.000.000 €.');
      if (!(km >= 0 && km <= 2000000)) return fail('Neispravna kilometraža.');
      if (!FUELS.includes(b.fuel) || !GEARS.includes(b.transmission)) return fail('Izaberite gorivo i menjač.');
      if (!/^\+\d{8,15}$/.test(phone)) return fail('Kontakt telefon mora biti u formatu +381641234567.');
      if (!files.length) return fail('Dodajte bar jednu sliku.');
      const active = db.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id=? AND status='active'`).get(req.uid).n;
      if (active >= MAX_ACTIVE) return fail(`Maksimalno ${MAX_ACTIVE} aktivnih oglasa.`, 403);

      const id = 'user:' + crypto.randomUUID(), now = new Date().toISOString();
      const imgs = files.map(f => '/uploads/' + f.filename);
      db.transaction(() => {
        db.prepare(`INSERT INTO listings (id,source,owner_id,brand,model,year,price,mileage,fuel,transmission,engine,body,location,image,images,link,description,contact_phone,first_seen,last_seen)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, 'user', req.uid, brand, model, year, price, km, b.fuel, b.transmission,
          str(b.engine, 60), str(b.body, 30), str(b.location, 60) || 'Srbija', imgs[0], JSON.stringify(imgs),
          `${process.env.PUBLIC_URL || ''}/#${id}`, str(b.description, 2000), phone, now, now);
        db.prepare('INSERT INTO price_history (listing_id, price, seen_at) VALUES (?,?,?)').run(id, price, now);
      })();
      after();
      res.status(201).json(toCar(db.prepare('SELECT * FROM listings WHERE id=?').get(id)));
    });
  });

  r.patch('/listings/:id', (req, res) => {
    const l = mine(req.params.id, req.uid); if (!l) return bad(res, 'Nije pronađeno.', 404);
    const b = req.body || {}, now = new Date().toISOString();
    db.transaction(() => {
      if (b.price !== undefined) {
        const p = parseInt(b.price);
        if (!(p >= 100 && p <= 2000000)) throw new Error('Neispravna cena.');
        if (p !== l.price) { db.prepare('UPDATE listings SET price=? WHERE id=?').run(p, l.id); db.prepare('INSERT INTO price_history (listing_id, price, seen_at) VALUES (?,?,?)').run(l.id, p, now); }
      }
      if (b.mileage !== undefined) { const k = parseInt(b.mileage); if (!(k >= 0 && k <= 2000000)) throw new Error('Neispravna kilometraža.'); db.prepare('UPDATE listings SET mileage=? WHERE id=?').run(k, l.id); }
      if (b.description !== undefined) db.prepare('UPDATE listings SET description=? WHERE id=?').run(str(b.description, 2000), l.id);
      if (b.status === 'sold') db.prepare(`UPDATE listings SET status='sold', expired_at=? WHERE id=?`).run(now, l.id);
      if (b.status === 'active' || b.renew) {   // ponovo aktiviraj / obnovi na još 60 dana
        const act = db.prepare(`SELECT COUNT(*) n FROM listings WHERE owner_id=? AND status='active' AND id<>?`).get(req.uid, l.id).n;
        if (act >= MAX_ACTIVE) throw new Error(`Maksimalno ${MAX_ACTIVE} aktivnih oglasa.`);
        db.prepare(`UPDATE listings SET status='active', expired_at=NULL, last_seen=? WHERE id=?`).run(now, l.id);
      }
    })();
    after();
    res.json(toCar(db.prepare('SELECT * FROM listings WHERE id=?').get(l.id)));
  });

  r.delete('/listings/:id', (req, res) => {
    const l = mine(req.params.id, req.uid); if (!l) return bad(res, 'Nije pronađeno.', 404);
    db.prepare('DELETE FROM listings WHERE id=?').run(l.id); rmFiles(l.images); res.json({ ok: true });
  });

  // greške iz transakcija (validacija) vraćaju se kao 400
  r.use((e, q, res, n) => bad(res, e.message || 'Greška.'));
  return r;
};
