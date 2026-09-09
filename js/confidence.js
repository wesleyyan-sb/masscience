/**
 * Masscience V2 — Confidence estimation (separate scores per inference type)
 */
import { TREND, TDEE, BODY_COMP } from './constants.js';
import { clamp, confidenceLabel, daysBetween } from './utils.js';

export function calculateTrendConfidence(ctx) {
  const {
    measuredCount = 0,
    observationSpanDays = 0,
    r2 = 0,
    residualCv = 1,
    estimatedStreak = 0,
    rateStandardError = 1,
    missingDayPenalty = 0,
  } = ctx;

  if (measuredCount < TREND.MIN_MEASUREMENTS) return buildConfidence(15, 'Insufficient measurements');

  let score = 0;
  score += Math.min(measuredCount / 24, 1) * 28;
  score += Math.min(observationSpanDays / 28, 1) * 18;
  score += clamp(r2, 0, 1) * 22;

  const noiseScore = residualCv < 0.003 ? 18 : residualCv < 0.006 ? 12 : residualCv < 0.01 ? 6 : 0;
  score += noiseScore;

  const ratePrecision = rateStandardError > 0
    ? clamp(1 - rateStandardError / 0.15, 0, 1) * 14
    : 0;
  score += ratePrecision;

  if (estimatedStreak > TREND.MAX_ESTIMATED_STREAK) score -= 12;
  score -= Math.round(missingDayPenalty * 18);

  return buildConfidence(clamp(Math.round(score), 0, 92), null);
}

export function calculateTDEEConfidence(ctx) {
  const {
    measuredDays = 0,
    trendConfidence = 0,
    calorieAdjustments = 0,
    intakeIsTargetOnly = true,
    rateStandardError = 0.1,
  } = ctx;

  let score = TDEE.INITIAL_CONFIDENCE;
  score += Math.min(measuredDays / 28, 1) * 30;
  score += (trendConfidence / 100) * 25;

  if (!intakeIsTargetOnly) score += 20;
  else score -= 10;

  score += Math.min(calorieAdjustments / 3, 1) * 10;
  score += clamp(1 - rateStandardError / 0.2, 0, 1) * 10;

  return buildConfidence(clamp(Math.round(score), 0, 88), intakeIsTargetOnly
    ? 'TDEE inferred from calorie target — food intake not logged'
    : null);
}

export function calculateBFConfidence(sources) {
  const count = sources.filter(s => s.weight > 0).length;
  if (count === 0) return buildConfidence(20, 'Only initial user estimate');

  let score = 25;
  score += Math.min(count, 3) * 15;
  const avgSigma = sources.reduce((a, s) => a + (s.sigma || BODY_COMP.SIGMA_USER_BF), 0) / sources.length;
  score += clamp((5 - avgSigma) / 5, 0, 1) * 30;

  if (sources.some(s => s.type === 'dexa')) score += 25;
  else if (sources.some(s => s.type === 'caliper')) score += 20;
  else if (sources.some(s => s.type === 'bia')) score += 8;
  else if (sources.some(s => s.type === 'navy')) score += 3;

  const hasHighPrecision = sources.some(s => s.type === 'dexa' || s.type === 'caliper');
  return buildConfidence(
    clamp(Math.round(score), 0, 88),
    hasHighPrecision ? 'Direct measurement calibrated' : 'Heuristic confidence — probabilistic model'
  );
}

export function calculateProjectionConfidence(ctx) {
  const {
    trendConfidence = 0,
    bfConfidence = 0,
    tdeeConfidence = 0,
    weeksAhead = 0,
  } = ctx;

  const base = (trendConfidence * 0.45 + bfConfidence * 0.35 + tdeeConfidence * 0.2);
  const decay = Math.max(0, 1 - weeksAhead * 0.04);
  return buildConfidence(clamp(Math.round(base * decay), 0, 80), null);
}

export function calculateOverallConfidence(scores) {
  const vals = Object.values(scores).map(s => s?.score ?? s).filter(v => typeof v === 'number');
  if (!vals.length) return buildConfidence(0, null);
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  return buildConfidence(Math.round(avg), null);
}

function buildConfidence(score, note) {
  return {
    score,
    label: confidenceLabel(score),
    note,
  };
}

export function formatConfidenceLabel(label) {
  const map = {
    very_low: 'Very low',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    very_high: 'Very high',
  };
  return map[label] || label;
}
