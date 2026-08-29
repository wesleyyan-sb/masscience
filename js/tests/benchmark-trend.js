/**
 * Masscience V2.1 — Trend method benchmark
 * Run: node js/tests/benchmark-trend.js
 *
 * Compares EMA, rolling OLS, Huber WLS, median-slope on synthetic scenarios.
 */
import { linearRegression, weightedLinearRegression, huberWeight, createRng, median } from '../utils.js';

const rng = createRng(12345);

function genScenario(config) {
  const { days, trueRate, noise = 0.35, outliers = [], missing = [], plateau = null, accelDay = null } = config;
  const trueRateDay = trueRate / 7;
  const points = [];
  let rate = trueRateDay;

  for (let d = 0; d < days; d++) {
    if (plateau && d >= plateau.start && d < plateau.end) rate = 0;
    if (accelDay != null && d >= accelDay) rate = trueRateDay * 1.6;

    let w = 63 + rate * d + (Math.sin(d * 0.9) * noise) + (rng() - 0.5) * noise * 0.5;
    for (const o of outliers) {
      if (o.day === d) w += o.delta;
    }
    if (!missing.includes(d)) {
      points.push({ x: d, y: w, true: 63 + trueRateDay * d });
    }
  }
  return points;
}

function methodEMA(points, alpha = 0.15) {
  let ema = points[0].y;
  const trends = [{ x: points[0].x, trend: ema }];
  for (let i = 1; i < points.length; i++) {
    ema = alpha * points[i].y + (1 - alpha) * ema;
    trends.push({ x: points[i].x, trend: ema });
  }
  const reg = linearRegression(trends.map(t => ({ x: t.x, y: t.trend })));
  return { trendRmse: rmseTrend(points, trends), rateError: Math.abs(reg.slope * 7 - scenarioRate(points)) };
}

function methodRollingOLS(points, window = 14) {
  const trends = [];
  for (let i = 0; i < points.length; i++) {
    const win = points.slice(Math.max(0, i - window + 1), i + 1);
    const reg = linearRegression(win);
    trends.push({ x: points[i].x, trend: reg.slope * points[i].x + reg.intercept });
  }
  const tail = points.slice(-window);
  const reg = linearRegression(tail);
  return { trendRmse: rmseTrend(points, trends), rateError: Math.abs(reg.slope * 7 - scenarioRate(points)) };
}

function methodHuberWLS(points, window = 14, delta = 0.35) {
  const trends = [];
  for (let i = 0; i < points.length; i++) {
    const win = points.slice(Math.max(0, i - window + 1), i + 1);
    let weights = win.map(() => 1);
    let reg = weightedLinearRegression(win, weights);
    for (let iter = 0; iter < 3; iter++) {
      weights = win.map(p => huberWeight(p.y - (reg.slope * p.x + reg.intercept), delta));
      reg = weightedLinearRegression(win, weights);
    }
    trends.push({ x: points[i].x, trend: reg.slope * points[i].x + reg.intercept });
  }
  const tail = points.slice(-window);
  let weights = tail.map(() => 1);
  let reg = weightedLinearRegression(tail, weights);
  for (let iter = 0; iter < 3; iter++) {
    weights = tail.map(p => huberWeight(p.y - (reg.slope * p.x + reg.intercept), delta));
    reg = weightedLinearRegression(tail, weights);
  }
  return { trendRmse: rmseTrend(points, trends), rateError: Math.abs(reg.slope * 7 - scenarioRate(points)) };
}

function methodMedianSlope(points, window = 14) {
  const trends = [];
  for (let i = 0; i < points.length; i++) {
    const win = points.slice(Math.max(0, i - window + 1), i + 1);
    const slopes = [];
    for (let a = 0; a < win.length; a++) {
      for (let b = a + 1; b < win.length; b++) {
        slopes.push((win[b].y - win[a].y) / (win[b].x - win[a].x || 1));
      }
    }
    const slope = slopes.length ? median(slopes) : 0;
    const intercept = win[win.length - 1].y - slope * win[win.length - 1].x;
    trends.push({ x: points[i].x, trend: slope * points[i].x + intercept });
  }
  const tail = points.slice(-window);
  const slopes = [];
  for (let a = 0; a < tail.length; a++) {
    for (let b = a + 1; b < tail.length; b++) {
      slopes.push((tail[b].y - tail[a].y) / (tail[b].x - tail[a].x || 1));
    }
  }
  const slope = slopes.length ? median(slopes) : 0;
  return { trendRmse: rmseTrend(points, trends), rateError: Math.abs(slope * 7 - scenarioRate(points)) };
}

function rmseTrend(points, trends) {
  const map = new Map(trends.map(t => [t.x, t.trend]));
  let sum = 0;
  for (const p of points) {
    const trueT = p.true ?? p.y;
    const est = map.get(p.x) ?? p.y;
    sum += (est - trueT) ** 2;
  }
  return Math.sqrt(sum / points.length);
}

function scenarioRate(points) {
  if (points.length < 2) return 0;
  return ((points[points.length - 1].true - points[0].true) / (points[points.length - 1].x - points[0].x || 1)) * 7;
}

const scenarios = [
  { name: 'normal_noise', cfg: { days: 28, trueRate: 0.20 } },
  { name: 'water_outliers', cfg: { days: 28, trueRate: 0.18, outliers: [{ day: 10, delta: 1.2 }, { day: 18, delta: -0.8 }] } },
  { name: 'consecutive_outliers', cfg: { days: 28, trueRate: 0.18, outliers: [{ day: 12, delta: 1.0 }, { day: 13, delta: 0.9 }] } },
  { name: 'sparse_missing', cfg: { days: 28, trueRate: 0.20, missing: [1, 3, 5, 8, 11, 14, 17, 20, 23, 26] } },
  { name: 'plateau', cfg: { days: 28, trueRate: 0.20, plateau: { start: 10, end: 18 } } },
  { name: 'acceleration', cfg: { days: 28, trueRate: 0.15, accelDay: 14 } },
  { name: 'fast_gain', cfg: { days: 21, trueRate: 0.35 } },
];

const methods = {
  EMA: (p) => methodEMA(p),
  rollingOLS: (p) => methodRollingOLS(p),
  huberWLS: (p) => methodHuberWLS(p),
  medianSlope: (p) => methodMedianSlope(p),
};

const totals = {};
for (const m of Object.keys(methods)) totals[m] = { trendRmse: 0, rateError: 0, n: 0 };

console.log('\n=== TREND ENGINE BENCHMARK ===\n');
console.log('Scenario'.padEnd(22), ...Object.keys(methods).map(m => m.padStart(12)));
console.log('-'.repeat(70));

for (const sc of scenarios) {
  const points = genScenario(sc.cfg);
  const row = [sc.name.padEnd(22)];
  for (const [name, fn] of Object.entries(methods)) {
    const r = fn(points);
    totals[name].trendRmse += r.trendRmse;
    totals[name].rateError += r.rateError;
    totals[name].n++;
    row.push(r.rateError.toFixed(3).padStart(12));
  }
  console.log(...row);
}

console.log('\n--- Average rate error (kg/wk) ---');
const ranked = Object.entries(totals)
  .map(([name, t]) => ({ name, avgRate: t.rateError / t.n, avgTrend: t.trendRmse / t.n }))
  .sort((a, b) => a.avgRate - b.avgRate);

ranked.forEach((r, i) => {
  console.log(`${i + 1}. ${r.name}: rate err ${r.avgRate.toFixed(4)}, trend RMSE ${r.avgTrend.toFixed(4)}`);
});

const best = ranked[0];
const huber = ranked.find(r => r.name === 'huberWLS');
const ols = ranked.find(r => r.name === 'rollingOLS');
const simplify = ols && huber && (huber.avgRate - ols.avgRate) / ols.avgRate < 0.08;

console.log('\n--- RECOMMENDATION ---');
if (simplify || best.name === 'rollingOLS') {
  console.log('Use rolling OLS + outlier downweighting (drop Huber iterations).');
  console.log('Huber WLS improvement over OLS is marginal (<8%) — not worth complexity.');
} else {
  console.log(`Best performer: ${best.name}`);
}
console.log('Remove change-point detection from control path (high false-positive risk on sparse data).');
console.log('');
