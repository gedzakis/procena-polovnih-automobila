// Ista logika kao filteri u frontendu (applyFilters), da sačuvana pretraga daje iste rezultate.
function matches(car, f = {}) {
  const diff = car.market_price - car.price;
  if (f.search && !`${car.brand} ${car.model}`.toLowerCase().includes(String(f.search).toLowerCase())) return false;
  if (f.brand && car.brand !== f.brand) return false;
  if (f.maxPrice && car.price > Number(f.maxPrice)) return false;
  if (f.minYear && car.year < Number(f.minYear)) return false;
  if (f.fuel && car.fuel !== f.fuel) return false;
  if (f.risk && car.risk !== f.risk) return false;
  if (f.deal === 'ispod' && diff <= 300) return false;
  if (f.deal === 'fer' && (diff > 300 || diff < -300)) return false;
  if (f.deal === 'iznad' && diff >= -300) return false;
  return true;
}
module.exports = { matches };
