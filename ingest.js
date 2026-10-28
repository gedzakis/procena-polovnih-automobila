// Upis rezultata scrapera: novi oglasi, istorija cena, označavanje isteklih, brisanje starih.
const db = require('./db');
const { rescoreAll } = require('./scoring');

const EXPIRE_AFTER = Number(process.env.EXPIRE_AFTER_MISSES || 2);
const PURGE_DAYS = Number(process.env.PURGE_AFTER_DAYS || 30);

function ingest(source, cars) {
  const now = new Date().toISOString();
  const stats = { found: cars.length, newCount: 0, priceChanges: 0, expired: 0, purged: 0 };
  const get = db.prepare('SELECT price, status FROM listings WHERE id=?');
  const insert = db.prepare(`INSERT INTO listings (id,source,brand,model,year,price,mileage,fuel,transmission,engine,body,location,image,link,checks,first_seen,last_seen)
    VALUES (@id,@source,@brand,@model,@year,@price,@mileage,@fuel,@transmission,@engine,@body,@location,@image,@link,@checks,@now,@now)`);
  const update = db.prepare(`UPDATE listings SET price=@price, mileage=@mileage, location=@location, image=@image, link=@link,
    status='active', missed_runs=0, expired_at=NULL, last_seen=@now WHERE id=@id`);
  const hist = db.prepare('INSERT INTO price_history (listing_id, price, seen_at) VALUES (?,?,?)');

  db.transaction(() => {
    const seen = new Set();
    for (const c of cars) {
      const id = `${source}:${c.ext_id}`;
      seen.add(id);
      const row = { ...c, id, source, now, checks: JSON.stringify(c.checks || []) };
      const old = get.get(id);
      if (!old) { insert.run(row); hist.run(id, c.price, now); stats.newCount++; }
      else {
        update.run(row);
        if (old.price !== c.price) { hist.run(id, c.price, now); stats.priceChanges++; }
      }
    }
    // Oglasi ovog izvora koji nisu viđeni u ovom prolazu
    const active = db.prepare(`SELECT id, missed_runs FROM listings WHERE source=? AND status='active'`).all(source);
    for (const a of active) {
      if (seen.has(a.id)) continue;
      if (a.missed_runs + 1 >= EXPIRE_AFTER) {
        db.prepare(`UPDATE listings SET status='expired', expired_at=?, missed_runs=missed_runs+1 WHERE id=?`).run(now, a.id);
        stats.expired++;
      } else db.prepare('UPDATE listings SET missed_runs=missed_runs+1 WHERE id=?').run(a.id);
    }
    // Trajno brisanje starih isteklih (istorija cena se briše kaskadno)
    const cutoff = new Date(Date.now() - PURGE_DAYS * 864e5).toISOString();
    stats.purged = db.prepare(`DELETE FROM listings WHERE status='expired' AND expired_at < ?`).run(cutoff).changes;
  })();

  rescoreAll(db);
  return stats;
}
module.exports = { ingest };
