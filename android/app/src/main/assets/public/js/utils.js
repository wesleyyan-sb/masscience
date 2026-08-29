/**
 * Masscience — Utility functions
 */

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function round(value, decimals = 1) {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

export function formatDate(date) {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().split('T')[0];
}

export function parseDate(str) {
  if (typeof str !== 'string' || !str.trim()) return null;
  const d = new Date(str + 'T12:00:00');
  return isNaN(d.getTime()) ? null : d;
}

export function daysBetween(date1, date2) {
  if (!date1 || !date2) return 0;
  const d1 = parseDate(typeof date1 === 'string' ? date1 : formatDate(date1));
  const d2 = parseDate(typeof date2 === 'string' ? date2 : formatDate(date2));
  if (!d1 || !d2) return 0;
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

export function addDays(dateStr, days) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function today() {
  return formatDate(new Date());
}

/** Convert kg ↔ lb, cm ↔ in at UI boundary */
export function kgToLb(kg) { return kg * 2.20462; }
export function lbToKg(lb) { return lb / 2.20462; }
export function cmToIn(cm) { return cm / 2.54; }
export function inToCm(inches) { return inches * 2.54; }

export function formatWeight(kg, units = 'metric') {
  if (units === 'imperial') return `${round(kgToLb(kg), 1)} lb`;
  return `${round(kg, 1)} kg`;
}

export function formatHeight(cm, units = 'metric') {
  if (units === 'imperial') {
    const totalIn = cmToIn(cm);
    const ft = Math.floor(totalIn / 12);
    const inches = round(totalIn % 12, 0);
    return `${ft}'${inches}"`;
  }
  return `${round(cm, 0)} cm`;
}

export function formatCalories(kcal) {
  return `${Math.round(kcal).toLocaleString()} kcal`;
}

export function formatLiters(ml) {
  return `${round(ml / 1000, 1)} L`;
}

export function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mad(values) {
  if (values.length < 2) return 0;
  const med = median(values);
  const deviations = values.map(v => Math.abs(v - med));
  return median(deviations);
}

export function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0, standardError: 0, n };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumX2 += p.x * p.x;
    sumY2 += p.y * p.y;
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0, standardError: 0, n };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const ssTot = sumY2 - (sumY * sumY) / n;
  const residuals = points.map(p => p.y - (slope * p.x + intercept));
  const ssRes = residuals.reduce((a, r) => a + r * r, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const standardError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;

  return { slope, intercept, r2: clamp(r2, 0, 1), standardError, n, residuals };
}

/** Weighted least-squares linear regression */
export function weightedLinearRegression(points, weights) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y ?? 0, r2: 0, standardError: 0, n };

  let sumW = 0, sumWX = 0, sumWY = 0, sumWXY = 0, sumWX2 = 0, sumWY2 = 0;
  for (let i = 0; i < n; i++) {
    const w = weights[i] ?? 1;
    const x = points[i].x;
    const y = points[i].y;
    sumW += w;
    sumWX += w * x;
    sumWY += w * y;
    sumWXY += w * x * y;
    sumWX2 += w * x * x;
    sumWY2 += w * y * y;
  }

  const denom = sumW * sumWX2 - sumWX * sumWX;
  if (denom === 0) return { slope: 0, intercept: sumWY / sumW, r2: 0, standardError: 0, n };

  const slope = (sumW * sumWXY - sumWX * sumWY) / denom;
  const intercept = (sumWY - slope * sumWX) / sumW;

  const fitted = points.map(p => slope * p.x + intercept);
  const residuals = points.map((p, i) => p.y - fitted[i]);
  const ssRes = residuals.reduce((a, r, i) => a + (weights[i] ?? 1) * r * r, 0);
  const yMean = sumWY / sumW;
  const ssTot = points.reduce((a, p, i) => {
    const w = weights[i] ?? 1;
    return a + w * (p.y - yMean) ** 2;
  }, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const df = Math.max(n - 2, 1);
  const standardError = Math.sqrt(ssRes / df);

  return { slope, intercept, r2: clamp(r2, 0, 1), standardError, n, residuals };
}

/** Huber down-weight for robustness */
export function huberWeight(residual, delta) {
  const a = Math.abs(residual);
  return a <= delta ? 1 : delta / a;
}

export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function iqr(values) {
  if (values.length < 4) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.75) - percentile(sorted, 0.25);
}

/** Seeded PRNG for reproducible Monte Carlo (Mulberry32) */
export function createRng(seed = 42) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomNormal(rng) {
  let u = 0; let v = 0;
  while (u <= Number.MIN_VALUE) u = rng();
  while (v <= Number.MIN_VALUE) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function confidenceLabel(score) {
  if (score < 40) return 'very_low';
  if (score < 55) return 'low';
  if (score < 72) return 'moderate';
  if (score < 85) return 'high';
  return 'very_high';
}

export function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function getWeekNumber(startDate, currentDate) {
  const days = daysBetween(startDate, currentDate);
  return Math.floor(days / 7) + 1;
}

export function escapeHtml(str) {
  if (typeof document === 'undefined') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
