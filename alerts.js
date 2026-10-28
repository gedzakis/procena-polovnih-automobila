// Posle svakog scrape-a: proveri sve aktivne sačuvane pretrage i pošalji ono što još nije poslato.
const db = require('./db');
const { matches } = require('./matcher');
const { notify } = require('./notifiers');

async function runAlerts() {
  const cars = db.prepare(`SELECT * FROM listings WHERE status='active'`).all();
  const searches = db.prepare(`SELECT s.*, u.email, u.phone, u.viber_id FROM saved_searches s JOIN users u ON u.id=s.user_id WHERE s.active=1`).all();
  const seen = db.prepare('SELECT 1 FROM notifications WHERE search_id=? AND listing_id=? AND kind=?');
  const mark = db.prepare('INSERT OR IGNORE INTO notifications VALUES (?,?,?,?)');
  const lastTwo = db.prepare('SELECT price FROM price_history WHERE listing_id=? ORDER BY id DESC LIMIT 2');
  let sent = 0;

  for (const s of searches) {
    const filters = JSON.parse(s.filters), channels = JSON.parse(s.channels);
    for (const car of cars) {
      if (car.score < s.min_score || !matches(car, filters)) continue;
      const kinds = ['new'];
      if (s.notify_price_drop) {
        const [cur, prev] = lastTwo.all(car.id);
        if (prev && cur.price < prev.price) kinds.push(`drop:${cur.price}`);
      }
      for (const kind of kinds) {
        if (seen.get(s.id, car.id, kind)) continue;
        // "new" šalje se jednom po oglasu; pad cene jednom po novoj ceni
        if (await notify(s, channels, car, kind)) { mark.run(s.id, car.id, kind, new Date().toISOString()); sent++; }
      }
    }
  }
  return sent;
}
module.exports = { runAlerts };
