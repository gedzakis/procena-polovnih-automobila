// AE Ocena (0-10), procena tržišne cene i rizika - računa se iz podataka u bazi.
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const firstWords = (model, n = 2) => (model || '').toLowerCase().split(/\s+/).slice(0, n).join(' ');

function estimateMarket(car, all) {
  const key = firstWords(car.model);
  const comps = all.filter(c => c.id !== car.id && c.brand === car.brand &&
    firstWords(c.model) === key && Math.abs(c.year - car.year) <= 1);
  if (comps.length >= 3) {
    const adj = comps.map(c => c.price + (c.mileage - car.mileage) * 0.04); // korekcija za km
    return Math.round(median(adj));
  }
  return null; // nema dovoljno uporedivih -> neutralno (tržišna = cena oglasa)
}

function riskOf(car) {
  const age = new Date().getFullYear() - car.year;
  if (car.mileage > 220000 || age > 10) return 'Visok';
  if (car.mileage > 150000 || age > 7) return 'Srednji';
  return 'Nizak';
}

function scoreOf(car, market) {
  let s = 7.0;
  const pct = ((market - car.price) / market) * 100;                       // + = ispod tržišne
  s += Math.max(-2, Math.min(2, pct / 5 * 0.5));                           // svakih 5% = 0.5
  const age = Math.max(1, new Date().getFullYear() - car.year);
  const expectedKm = age * 15000;
  s += Math.max(-1.2, Math.min(0.8, (expectedKm - car.mileage) / expectedKm * 1.5));
  s += Math.max(-0.5, Math.min(0.8, (car.year - 2015) * 0.1));
  s += { Nizak: 0.3, Srednji: 0, Visok: -0.8 }[car.risk] ?? 0;
  return Math.round(Math.max(1, Math.min(10, s)) * 10) / 10;
}

function rescoreAll(db) {
  const rows = db.prepare(`SELECT * FROM listings WHERE status='active'`).all();
  const upd = db.prepare(`UPDATE listings SET market_price=?, risk=?, score=? WHERE id=?`);
  db.transaction(() => {
    for (const c of rows) {
      const market = estimateMarket(c, rows) ?? c.price;
      const risk = riskOf(c);
      upd.run(market, risk, scoreOf({ ...c, risk }, market), c.id);
    }
  })();
}
module.exports = { rescoreAll };
