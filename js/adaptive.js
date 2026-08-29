/**
 * Masscience V2.1 — Adaptive TDEE & trajectory risk (informational only)
 */
import { CALORIES, TDEE, PHASE } from './constants.js';
import { clamp, round, daysBetween, today } from './utils.js';
import { calculateTDEEConfidence } from './confidence.js';

export function estimateAdaptiveTDEE(state, trendData, calorieTarget) {
  const initial = state.currentCycle?.initialTDEE ?? state.algorithmState?.estimatedTDEE;
  const prev = state.algorithmState?.estimatedTDEE ?? initial;

  if (!trendData?.rate?.perWeek || trendData.rate.insufficient) {
    return wrapTDEE(prev, initial, 30, calorieTarget);
  }

  const measuredDays = state.weightMeasurements.filter(m => !m.isEstimated).length;
  if (measuredDays < TDEE.MIN_OBSERVATION_DAYS) {
    const conf = calculateTDEEConfidence({
      measuredDays,
      trendConfidence: trendData.confidence,
      intakeIsTargetOnly: true,
    });
    return wrapTDEE(prev, initial, conf.score, calorieTarget);
  }

  const rateSE = trendData.rate.standardError ?? 0.12;
  const rate = trendData.rate.perWeek;
  const kcalPerKg = CALORIES.KCAL_PER_KG;
  const energyImbalance = (rate / 7) * kcalPerKg;
  const imbalanceUncertainty = (rateSE / 7) * kcalPerKg;
  const impliedTDEE = calorieTarget - energyImbalance;
  const learned = prev + TDEE.LEARNING_RATE * (impliedTDEE - prev);
  const bounded = clamp(learned, TDEE.MIN_KCAL, TDEE.MAX_KCAL);
  const estimate = clamp(bounded, prev - TDEE.MAX_WEEKLY_SHIFT, prev + TDEE.MAX_WEEKLY_SHIFT);
  const rangeHalf = imbalanceUncertainty + TDEE.INTAKE_UNCERTAINTY_KCAL + (100 - trendData.confidence);

  const conf = calculateTDEEConfidence({
    measuredDays,
    trendConfidence: trendData.confidence,
    calorieAdjustments: state.calorieHistory?.length ?? 0,
    intakeIsTargetOnly: true,
    rateStandardError: rateSE,
  });

  return {
    estimate: round(estimate, 0),
    low: round(clamp(estimate - rangeHalf, TDEE.MIN_KCAL, TDEE.MAX_KCAL), 0),
    high: round(clamp(estimate + rangeHalf, TDEE.MIN_KCAL, TDEE.MAX_KCAL), 0),
    confidence: conf.score,
    confidenceDetail: conf,
    impliedFromRate: round(impliedTDEE, 0),
    energyImbalance: round(energyImbalance, 0),
    note: 'Inferred from calorie target + weight trend — not measured expenditure',
  };
}

function wrapTDEE(estimate, initial, confidence, target) {
  const e = estimate ?? initial;
  const spread = TDEE.INTAKE_UNCERTAINTY_KCAL + (100 - confidence) * 2;
  return {
    estimate: round(e, 0),
    low: round(e - spread, 0),
    high: round(e + spread, 0),
    confidence,
    note: 'Insufficient trend data for strong TDEE inference',
    calorieTarget: target,
  };
}

/** Informational only — does NOT affect calorie controller (V2.1) */
export function calculateTrajectoryRisk(projection, maxBf, bfEstimate, trendConfidence) {
  if (!projection) {
    return { level: 'unknown', label: 'Unknown', modelProbability: null, message: 'Insufficient data.' };
  }

  const p = projection.modelProbabilityExceedCeiling ?? estimateCeilingRisk(projection, maxBf, bfEstimate);
  let level = 'LOW';
  if (p > 0.55) level = 'HIGH';
  else if (p > 0.30) level = 'MODERATE';

  if (trendConfidence < 45) {
    return {
      level: 'UNCERTAIN',
      label: 'Uncertain',
      modelProbability: round(p, 2),
      message: 'Trend confidence too low for reliable trajectory risk.',
      disclaimer: 'Model-estimated probability — not clinical.',
    };
  }

  return {
    level,
    label: level.charAt(0) + level.slice(1).toLowerCase(),
    modelProbability: round(p, 2),
    message: level === 'HIGH'
      ? 'Model suggests elevated risk of exceeding your BF ceiling before cycle end.'
      : level === 'MODERATE'
        ? 'Moderate model-estimated risk if current trend continues.'
        : 'Trajectory risk appears controlled under current assumptions.',
    disclaimer: 'Model-estimated probability — not clinical. Does not change calorie targets.',
  };
}

function estimateCeilingRisk(projection, maxBf, bfEstimate) {
  if (!projection?.bf?.high || !maxBf) return 0.2;
  const ceiling = typeof maxBf === 'object' ? maxBf.point : maxBf;
  if (projection.bf.high <= ceiling) return 0.1;
  return clamp(0.2 + (projection.bf.high - ceiling) * 0.12, 0, 0.85);
}

export function checkSafetyLimits(calories, phase, profile) {
  const warnings = [];
  const min = profile.sex === 'male' ? CALORIES.MIN_CALORIES_MALE : CALORIES.MIN_CALORIES_FEMALE;
  if (calories < min) warnings.push(`Target (${calories} kcal) is below typical safe minimum. Consult a professional.`);
  if (calories > CALORIES.MAX_CALORIES) warnings.push('Calorie target unusually high — verify inputs.');
  if (phase === PHASE.MINICUT && calories < 1400) warnings.push('Very low minicut target — consider smaller deficit.');
  return warnings;
}

export function calculateConsistencyScore(state, trendData) {
  let score = 0;
  const measured = state.weightMeasurements.filter(m => !m.isEstimated);
  const cycle = state.currentCycle;
  if (!cycle) return 0;
  const expectedDays = daysBetween(cycle.startDate, today()) + 1;
  score += Math.min(measured.length / Math.max(expectedDays * 0.45, 1), 1) * 35;
  score += ((trendData?.confidence ?? 0) / 100) * 35;
  score += Math.min(state.bodyMeasurements.length * 8, 20);
  if (trendData?.rate && !trendData.rate.insufficient && !state.calorieHistory?.length) score += 10;
  return clamp(Math.round(score), 0, 100);
}

export const updateEstimatedTDEE = (state, trendData, cal) => {
  const r = estimateAdaptiveTDEE(state, trendData, cal);
  return { estimatedTDEE: r.estimate, confidence: r.confidence, ...r };
};
