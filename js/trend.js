/**
 * Masscience V2.1 — Trend engine
 * Method: Rolling OLS (14d) + outlier downweighting — single pass.
 * Benchmark: Huber WLS removed (marginal gain, higher complexity).
 * Change-point detection removed from control path.
 */
import { TREND } from './constants.js';
import {
  formatDate, parseDate, daysBetween, median, mad, clamp, round,
  weightedLinearRegression,
} from './utils.js';
import { calculateTrendConfidence } from './confidence.js';

export function processWeightData(measurements, startDate, options = {}) {
  if (!measurements.length) return emptyTrendResult();

  const sorted = [...measurements].sort((a, b) => a.date.localeCompare(b.date));
  const measuredOnly = sorted.filter(m => !m.isEstimated);
  const regression = fitRollingTrend(measuredOnly, startDate, options);
  const series = buildTrendSeries(sorted, startDate, regression);
  const rate = calculateRateOfGain(series, measuredOnly, startDate, options);
  const residualCv = computeResidualCv(series);
  const estimatedStreak = countEstimatedStreak(sorted);
  const measuredCount = measuredOnly.length;
  const span = measuredCount > 1
    ? daysBetween(measuredOnly[0].date, measuredOnly[measuredOnly.length - 1].date) : 0;

  const trendConfidence = calculateTrendConfidence({
    measuredCount,
    observationSpanDays: span,
    r2: rate.r2,
    residualCv,
    estimatedStreak,
    rateStandardError: rate.standardError,
    hasChangePoint: false,
    missingDayPenalty: estimateMissingPenalty(sorted),
  });

  return {
    series,
    latest: series[series.length - 1] ?? null,
    rate,
    confidence: trendConfidence.score,
    confidenceDetail: trendConfidence,
    regression,
    method: 'rolling_ols_v2.1',
    noise: series.filter(s => s.noise != null).map(s => ({ date: s.date, noise: s.noise })),
    residualCv,
    measuredCount,
    observationSpanDays: span,
    estimatedStreak,
  };
}

function emptyTrendResult() {
  return {
    series: [], latest: null, rate: { perWeek: null, insufficient: true },
    confidence: 0, confidenceDetail: { score: 0, label: 'very_low' },
    regression: null, method: 'rolling_ols_v2.1', noise: [],
    residualCv: 1, measuredCount: 0, observationSpanDays: 0, estimatedStreak: 0,
  };
}

function fitRollingTrend(measuredOnly, startDate, options = {}) {
  if (measuredOnly.length < TREND.MIN_MEASUREMENTS) return null;

  const phaseStart = options.phaseStartDate;
  let win;
  let window;

  if (phaseStart) {
    const inPhase = measuredOnly.filter(m => m.date >= phaseStart);
    if (inPhase.length >= TREND.MIN_MEASUREMENTS) {
      window = clamp(inPhase.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
      win = measuredOnly.slice(-window);
    } else {
      window = clamp(measuredOnly.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
      win = measuredOnly.slice(-window);
    }
  } else {
    window = clamp(measuredOnly.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
    win = measuredOnly.slice(-window);
  }

  const points = win.map(m => ({
    x: startDate ? daysBetween(startDate, m.date) : 0,
    y: effectiveWeight(m),
  }));
  const weights = win.map((m, idx) => {
    let w = m.isOutlier ? TREND.WEIGHT_OUTLIER : localOutlierWeight(win, idx);
    if (phaseStart && m.date < phaseStart) {
      const daysPrior = Math.max(1, daysBetween(m.date, phaseStart));
      w *= clamp(Math.pow(0.5, daysPrior / 2.0), 0.04, 0.25);
    }
    return w;
  });

  return { ...weightedLinearRegression(points, weights), windowDays: window };
}

function localOutlierWeight(series, index) {
  const window = series.slice(Math.max(0, index - 5), Math.min(series.length, index + 6));
  if (window.length < 4) return TREND.WEIGHT_MEASURED;

  const med = median(window.map(m => m.weight));
  const madVal = mad(window.map(m => m.weight));
  const delta = Math.abs(series[index].weight - med);

  if (madVal > 0) {
    const z = Math.abs(0.6745 * delta / madVal);
    if (z > TREND.OUTLIER_MAD_THRESHOLD || delta > TREND.OUTLIER_FIXED_KG) {
      return TREND.WEIGHT_OUTLIER;
    }
  } else if (delta > TREND.OUTLIER_FIXED_KG) {
    return TREND.WEIGHT_OUTLIER;
  }

  return TREND.WEIGHT_MEASURED;
}

function effectiveWeight(m) {
  if (m.isOutlier && m.trendWeight != null) return m.trendWeight;
  return m.weight;
}

function buildTrendSeries(sorted, startDate, regression) {
  return sorted.map(m => {
    const dayIndex = startDate ? daysBetween(startDate, m.date) : 0;
    const trend = regression
      ? regression.slope * dayIndex + regression.intercept
      : m.weight;
    const observed = m.isEstimated ? null : m.weight;
    return {
      date: m.date, dayIndex,
      measured: observed,
      estimated: m.isEstimated ? m.weight : null,
      trend: round(trend, 2),
      noise: observed != null ? round(observed - trend, 2) : null,
      isEstimated: !!m.isEstimated,
      isOutlier: !!m.isOutlier,
    };
  });
}

export function calculateRateOfGain(series, measuredOnly, startDate, options = {}) {
  const usable = (measuredOnly && measuredOnly.length)
    ? measuredOnly
    : series.filter(s => s.measured != null || s.estimated != null);

  if (!usable.length) {
    return { perDay: null, perWeek: null, perWeekPercent: null, r2: 0, standardError: null, insufficient: true, windowDays: 0 };
  }

  const phaseStart = options.phaseStartDate;
  let win;
  let window;

  if (phaseStart) {
    const inPhase = usable.filter(m => m.date >= phaseStart);
    if (inPhase.length >= TREND.MIN_MEASUREMENTS) {
      window = clamp(inPhase.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
      win = usable.slice(-window);
    } else {
      window = clamp(usable.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
      win = usable.slice(-window);
    }
  } else {
    window = clamp(usable.length, TREND.WINDOW_MIN_DAYS, TREND.WINDOW_DEFAULT_DAYS);
    win = usable.slice(-window);
  }

  const points = win.map(m => ({
    x: startDate ? daysBetween(startDate, m.date) : (m.dayIndex ?? 0),
    y: effectiveWeight(m),
  }));
  const weights = win.map((m, idx) => {
    let w = m.isOutlier ? TREND.WEIGHT_OUTLIER : (m.isEstimated ? TREND.WEIGHT_ESTIMATED : localOutlierWeight(win, idx));
    if (phaseStart && m.date < phaseStart) {
      const daysPrior = Math.max(1, daysBetween(m.date, phaseStart));
      w *= clamp(Math.pow(0.5, daysPrior / 2.0), 0.04, 0.25);
    }
    return w;
  });
  const reg = weightedLinearRegression(points, weights);

  const latestWeight = series[series.length - 1]?.trend ?? points[points.length - 1]?.y ?? 0;
  const perWeek = reg.slope * 7;
  const slopeSE = reg.standardError / Math.sqrt(Math.max(window, 2));
  const insufficient = win.length < TREND.MIN_MEASUREMENTS_FOR_RATE;

  return {
    perDay: reg.slope,
    perWeek: round(perWeek, 3),
    perWeekPercent: latestWeight > 0 ? round((perWeek / latestWeight) * 100, 3) : null,
    r2: round(reg.r2, 3),
    standardError: round(slopeSE * 7, 3),
    insufficient,
    windowDays: window,
  };
}

function computeResidualCv(series) {
  const noises = series.map(s => s.noise).filter(n => n != null);
  if (noises.length < 3) return 1;
  const mean = series.reduce((a, s) => a + s.trend, 0) / series.length;
  if (mean === 0) return 1;
  return Math.sqrt(noises.reduce((a, n) => a + n * n, 0) / noises.length) / mean;
}

function countEstimatedStreak(sorted) {
  let streak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].isEstimated) streak++;
    else break;
  }
  return streak;
}

function estimateMissingPenalty(sorted) {
  const total = sorted.length;
  const estimated = sorted.filter(m => m.isEstimated).length;
  return estimated / Math.max(total, 1);
}

export function detectOutlier(measurements, newWeight) {
  const recent = measurements.filter(m => !m.isEstimated).slice(-14).map(m => m.weight);
  if (recent.length < TREND.OUTLIER_MIN_SAMPLE) return { isOutlier: false, reason: 'insufficient_data' };

  const med = median(recent);
  const madVal = mad(recent);
  let isOutlier = madVal > 0
    ? Math.abs(0.6745 * (newWeight - med) / madVal) > TREND.OUTLIER_MAD_THRESHOLD
    : Math.abs(newWeight - med) > TREND.OUTLIER_FIXED_KG;

  if (isOutlier) {
    return {
      isOutlier: true,
      trendWeight: round(med + (newWeight - med) * 0.15, 2),
      originalPreserved: true,
      reason: 'likely_water_or_noise',
    };
  }
  return { isOutlier: false };
}

export function estimateMissingWeights(measurements, startDate, endDate) {
  const measuredOnly = measurements.filter(m => !m.isEstimated);
  if (measuredOnly.length < 2) return [...measurements];

  const trendData = processWeightData(measuredOnly, startDate);
  const rate = trendData.rate?.perDay ?? 0;
  const lastMeasured = measuredOnly[measuredOnly.length - 1];
  const lastTrend = trendData.latest?.trend ?? lastMeasured.weight;
  const existing = new Map(measurements.map(m => [m.date, m]));
  const result = [...measurements];

  let current = parseDate(startDate);
  const end = parseDate(endDate);
  let estimatedStreak = 0;

  while (current <= end) {
    const dateStr = formatDate(current);
    if (!existing.has(dateStr) && estimatedStreak < TREND.MAX_ESTIMATED_STREAK) {
      estimatedStreak++;
      const daysFromLast = daysBetween(lastMeasured.date, dateStr);
      result.push({
        date: dateStr,
        weight: round(lastTrend + rate * daysFromLast, 2),
        isEstimated: true,
        isOutlier: false,
      });
    } else if (existing.has(dateStr) && !existing.get(dateStr).isEstimated) {
      estimatedStreak = 0;
    }
    current.setDate(current.getDate() + 1);
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function getTargetTrajectory(startWeight, startDay, targetRatePerWeek, numDays) {
  const ratePerDay = targetRatePerWeek / 7;
  return Array.from({ length: numDays + 1 }, (_, d) => ({
    dayIndex: startDay + d,
    weight: round(startWeight + ratePerDay * d, 2),
  }));
}

export function isTrendStable(trendData) {
  return (trendData?.confidence ?? 0) >= 65 && (trendData?.residualCv ?? 1) < 0.004;
}

export function isTrendUnstable(trendData) {
  return (trendData?.confidence ?? 100) < 40 || (trendData?.residualCv ?? 0) > 0.008
    || (trendData?.estimatedStreak ?? 0) > 3;
}

export function getTrendUncertainty(trendData) {
  const se = trendData?.rate?.standardError ?? 0.15;
  const mult = (trendData?.confidence ?? 30) < 55 ? 2.0 : (trendData?.confidence ?? 30) < 72 ? 1.4 : 1.0;
  return round(se * mult, 3);
}

// Removed: detectChangePoint (V2.1 — not used in control; false positives on sparse data)
