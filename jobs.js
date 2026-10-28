require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cron = require('node-cron');
const db = require('./db');
const { ingest } = require('./ingest');
const { runAlerts } = require('./alerts');

const ADAPTERS = { demo: require('./scrapers/demo'), polovni: require('./scrapers/polovni') };
let running = false;

// Vlastiti oglasi: istek posle USER_LISTING_DAYS bez obnove; brisanje starih isteklih/prodatih + sirotih slika.
function maintainUserListings() {
  const fs = require('fs'), path = require('path');
  const days = Number(process.env.USER_LISTING_DAYS || 60), purge = Number(process.env.PURGE_AFTER_DAYS || 30);
  const now = new Date().toISOString(), ago = d => new Date(Date.now() - d * 864e5).toISOString();
  const exp = db.prepare(`UPDATE listings SET status='expired', expired_at=? WHERE source='user' AND status='active' AND last_seen < ?`).run(now, ago(days)).changes;
  const old = db.prepare(`SELECT id, images FROM listings WHERE source='user' AND status IN ('expired','sold') AND expired_at < ?`).all(ago(purge));
  for (const l of old) { db.prepare('DELETE FROM listings WHERE id=?').run(l.id); }
  const dir = path.join(__dirname, '..', 'data', 'uploads');
  if (fs.existsSync(dir)) {
    const used = new Set(db.prepare(`SELECT images FROM listings WHERE images IS NOT NULL`).all().flatMap(r => JSON.parse(r.images || '[]').map(u => path.basename(u))));
    for (const f of fs.readdirSync(dir)) if (!used.has(f) && fs.statSync(path.join(dir, f)).mtimeMs < Date.now() - 36e5) fs.unlinkSync(path.join(dir, f));
  }
  if (exp || old.length) console.log(`[maintenance] isteklo: ${exp}, obrisano: ${old.length}`);
}

async function runOnce() {
  if (running) return { skipped: true };
  running = true;
  const report = [];
  try {
    for (const name of (process.env.SOURCES ?? 'demo').split(',').map(s => s.trim()).filter(Boolean)) {
      const ad = ADAPTERS[name]; if (!ad) { console.warn('Nepoznat izvor:', name); continue; }
      const started = new Date().toISOString();
      try {
        const cars = await ad.fetchAll();
        const st = ingest(ad.name, cars);        // ingest se poziva SAMO kad je scrape uspeo,
        db.prepare('INSERT INTO scrape_runs (source,started_at,finished_at,found,new_count,price_changes,expired) VALUES (?,?,?,?,?,?,?)')
          .run(name, started, new Date().toISOString(), st.found, st.newCount, st.priceChanges, st.expired);
        report.push({ source: name, ...st });  // pa greška na sajtu ne "istekne" sve oglase odjednom
        console.log(`[scrape:${name}]`, st);
      } catch (e) {
        db.prepare('INSERT INTO scrape_runs (source,started_at,finished_at,error) VALUES (?,?,?,?)').run(name, started, new Date().toISOString(), e.message);
        console.error(`[scrape:${name}] GREŠKA:`, e.message);
        report.push({ source: name, error: e.message });
      }
    }
    maintainUserListings();
    const sent = await runAlerts();
    if (sent) console.log(`[alerts] poslato obaveštenja: ${sent}`);
  } finally { running = false; }
  return report;
}

function start() {
  runOnce();
  cron.schedule(process.env.SCRAPE_CRON || '*/30 * * * *', runOnce);
}
module.exports = { runOnce, start };
if (require.main === module && process.argv.includes('--once')) runOnce().then(() => process.exit(0));
