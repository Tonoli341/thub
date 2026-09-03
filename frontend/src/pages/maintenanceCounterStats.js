// Aggregazioni pure sulle letture del contatore ore di un asset Manutenzioni
// (frontend/src/pages/MaintenanceAssetDetailPage.jsx). Le letture sono un
// contatore cumulativo (es. ore motore), non un valore puntuale: le
// variazioni si calcolano come differenza tra l'ultima lettura di un periodo
// e l'ultima lettura del periodo precedente.

function periodKey(dateStr, length) {
  return dateStr.slice(0, length);
}

// Ultima lettura (per data) di ciascun periodo (mese "YYYY-MM" o anno
// "YYYY"), ordinate per periodo crescente.
function lastReadingPerPeriod(readings, keyLength) {
  const byPeriod = new Map();
  for (const reading of readings) {
    const key = periodKey(reading.reading_date, keyLength);
    const current = byPeriod.get(key);
    if (!current || reading.reading_date > current.reading_date) {
      byPeriod.set(key, reading);
    }
  }
  return Array.from(byPeriod.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, reading]) => ({ key, value: reading.value }));
}

function consecutiveDeltas(points) {
  const deltas = [];
  for (let i = 1; i < points.length; i += 1) {
    deltas.push(points[i].value - points[i - 1].value);
  }
  return deltas;
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function previousMonthKey(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  return `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
}

function previousYearKey(yearKey) {
  return String(Number(yearKey) - 1);
}

// Classifica del parco per una singola classe di asset (dashboard ore in
// MaintenanceAssetsPage.jsx): stessa logica "ultima lettura per periodo" di
// computeCounterStats, applicata per asset e poi ordinata tra asset diversi.
//
// `readings` è la lista piatta di tutte le letture "ore" della classe (dal
// nuovo endpoint /asset-classes/{id}/counters), ciascuna con asset_id e
// asset_internal_code. `referenceDate` individua oggi/mese/anno correnti,
// passabile esplicitamente per i test.
//
// Per "oggi" non si richiede una lettura esattamente ieri (a differenza di
// mese/anno, dove si pretende il periodo immediatamente precedente): con
// letture non giornaliere sarebbe quasi sempre vuoto. Basta la lettura più
// recente *prima* di oggi, qualunque sia la sua data.
export function computeFleetHoursLeaderboard(readings, referenceDate = new Date()) {
  const readingsByAsset = new Map();
  for (const reading of readings) {
    if (!readingsByAsset.has(reading.asset_id)) readingsByAsset.set(reading.asset_id, []);
    readingsByAsset.get(reading.asset_id).push(reading);
  }

  const todayKey = periodKey(referenceDate.toISOString().slice(0, 10), 10);
  const monthKey = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const yearKey = String(referenceDate.getFullYear());

  const totals = [];
  const today = [];
  const month = [];
  const year = [];

  for (const [assetId, assetReadings] of readingsByAsset) {
    const assetCode = assetReadings[0]?.asset_internal_code ?? assetId;
    const sorted = [...assetReadings].sort((a, b) => (a.reading_date < b.reading_date ? -1 : a.reading_date > b.reading_date ? 1 : 0));
    const last = sorted[sorted.length - 1];
    if (last) totals.push({ asset_id: assetId, asset_internal_code: assetCode, value: last.value });

    const dailyPoints = lastReadingPerPeriod(sorted, 10);
    const todayPoint = dailyPoints.find((p) => p.key === todayKey);
    if (todayPoint) {
      const before = dailyPoints.filter((p) => p.key < todayKey).pop();
      if (before) today.push({ asset_id: assetId, asset_internal_code: assetCode, value: todayPoint.value - before.value });
    }

    const monthlyPoints = lastReadingPerPeriod(sorted, 7);
    const monthPoint = monthlyPoints.find((p) => p.key === monthKey);
    const prevMonthPoint = monthlyPoints.find((p) => p.key === previousMonthKey(monthKey));
    if (monthPoint && prevMonthPoint) {
      month.push({ asset_id: assetId, asset_internal_code: assetCode, value: monthPoint.value - prevMonthPoint.value });
    }

    const yearlyPoints = lastReadingPerPeriod(sorted, 4);
    const yearPoint = yearlyPoints.find((p) => p.key === yearKey);
    const prevYearPoint = yearlyPoints.find((p) => p.key === previousYearKey(yearKey));
    if (yearPoint && prevYearPoint) {
      year.push({ asset_id: assetId, asset_internal_code: assetCode, value: yearPoint.value - prevYearPoint.value });
    }
  }

  const byValueDesc = (list) => [...list].sort((a, b) => b.value - a.value);
  return {
    total: byValueDesc(totals),
    today: byValueDesc(today),
    month: byValueDesc(month),
    year: byValueDesc(year),
  };
}

// referenceDate: Date usata per individuare "il mese corrente" (di default
// oggi), passabile esplicitamente per i test.
export function computeCounterStats(readings, referenceDate = new Date()) {
  const monthlyPoints = lastReadingPerPeriod(readings, 7);
  const yearlyPoints = lastReadingPerPeriod(readings, 4);

  const currentMonthKey = `${referenceDate.getFullYear()}-${String(referenceDate.getMonth() + 1).padStart(2, "0")}`;
  const currentMonthPoint = monthlyPoints.find((p) => p.key === currentMonthKey);
  const previousMonthPoint = monthlyPoints.find((p) => p.key === previousMonthKey(currentMonthKey));
  const currentMonthDelta =
    currentMonthPoint && previousMonthPoint ? currentMonthPoint.value - previousMonthPoint.value : null;

  return {
    currentMonthDelta,
    monthlyAverage: mean(consecutiveDeltas(monthlyPoints)),
    yearlyAverage: mean(consecutiveDeltas(yearlyPoints)),
  };
}
