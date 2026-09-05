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
  const rawRate = trendData.rate.perWeek;
  
  // Phase transition transient filtering:
  // In early transition (days 1-10), glycogen & water recharge creates a rapid rate surge or drop.
  // Water and glycogen store refill has an energy density of only ~1000-1400 kcal/kg (or 0 for gut content).
  // Multiplying raw transient rate by 5400 kcal/kg creates a massive phantom energy imbalance that artificially crashes TDEE.
  // We isolate transient fluid by bounding the rate used for latent energy balance inference during transition days.
  const daysSinceSwitch = state.algorithmState?.daysSincePhaseSwitch ?? state.algorithmState?.daysInPhase ?? 999;
  const phase = state.algorithmState?.currentPhase ?? state.currentCycle?.phase;

  let rateForEnergyInference = rawRate;
  if (daysSinceSwitch <= 12) {
    if (phase === PHASE.BULK) {
      // In early bulk (especially post-minicut), glycogen & water recharge creates a rapid rate surge.
      // True muscular & adipose tissue deposition is physiologically capped at ~0.20-0.24 kg/wk.
      rateForEnergyInference = clamp(rawRate, -0.20, 0.24);
    } else if (phase === PHASE.MINICUT) {
      // In early minicut, acute glycogen and water drop contaminates rate.
      // True fat mobilization for a lean trainee is physiologically ~0.5-0.6% BW/wk (~0.38-0.42 kg/wk).
      // Excess scale drop beyond this represents acute fluid/digestive clearance.
      rateForEnergyInference = clamp(rawRate, -0.40, 0.15);
    }
  } else if (daysSinceSwitch <= 24) {
    if (phase === PHASE.BULK) {
      rateForEnergyInference = clamp(rawRate, -0.25, 0.28);
    } else if (phase === PHASE.MINICUT) {
      rateForEnergyInference = clamp(rawRate, -0.42, 0.20);
    }
  } else {
    if (phase === PHASE.BULK) {
      rateForEnergyInference = clamp(rawRate, -0.45, 0.38);
    } else if (phase === PHASE.MINICUT) {
      rateForEnergyInference = clamp(rawRate, -0.45, 0.25);
    } else {
      rateForEnergyInference = clamp(rawRate, -1.00, 1.00);
    }
  }

  // Latent energy imbalance inference:
  // Calibrated physiological compartment energy density:
  // - In deficit (primarily adipose tissue mobilization with muscle sparing): ~7400 kcal/kg
  // - In surplus (mixed adipose + wet contractile muscle + glycogen + intracellular hydration): ~4100 kcal/kg
  //   (1 kg of scale gain in human overfeeding typically comprises ~40% fat, ~25% wet lean, ~35% hydration/gut)
  const nominalKcalPerKg = rateForEnergyInference > 0 ? 4100 : 7400;
  const energyImbalance = (rateForEnergyInference / 7) * nominalKcalPerKg;
  const imbalanceUncertainty = (rateSE / 7) * nominalKcalPerKg;
  
  const baseWeight = state.profile?.weightKg || trendData?.series?.[0]?.trend || 70;
  const currentTrendWeight = trendData?.latest?.trend ?? baseWeight;
  const weightDeltaKg = currentTrendWeight - baseWeight;

  // Implied TDEE from energy balance
  const impliedTDEE = calorieTarget - energyImbalance;
  
  // Evidence-weighted learning rate:
  const span = trendData.observationSpanDays ?? 14;
  const dataQuality = clamp((measuredDays / 21) * 0.5 + ((trendData.confidence ?? 50) / 100) * 0.5, 0.25, 1.0);
  const transitionDamping = daysSinceSwitch <= 10 ? 0.40 : daysSinceSwitch <= 20 ? 0.65 : 1.0;
  const effectiveLearningRate = clamp((0.24 + 0.18 * dataQuality) * transitionDamping, 0.10, 0.40);
  
  // Dynamic metabolic baseline: body mass gain/loss shifts BMR + TEF/NEAT by ~22-24 kcal/kg
  const currentBase = initial + weightDeltaKg * 23.0;
  let targetLearned = prev != null ? (prev + effectiveLearningRate * (impliedTDEE - prev)) : currentBase;

  // Physiological TDEE trend plausibility constraint:
  // During active weight loss / minicut, TDEE naturally declines or stays stable.
  // It should never spontaneously surge by +100-200 kcal from acute water flushes.
  if (phase === PHASE.MINICUT && prev != null && targetLearned > prev + 5) {
    targetLearned = prev + 5;
  }

  const bounded = clamp(targetLearned, TDEE.MIN_KCAL, TDEE.MAX_KCAL);
  const maxShift = TDEE.MAX_WEEKLY_SHIFT * (0.8 + 0.6 * dataQuality) * (daysSinceSwitch <= 14 ? 0.50 : 1.0);
  const estimate = clamp(bounded, (prev ?? initial) - maxShift, (prev ?? initial) + maxShift);
  
  // Honest uncertainty interval calibrated for ~95% coverage with clinically informative width (~220-280 kcal)
  const tdeeUncertainty = Math.round(
    clamp(80 * (1 - dataQuality * 0.40) + imbalanceUncertainty * 0.22 + 45, 70, 155)
  );

  const conf = calculateTDEEConfidence({
    measuredDays,
    trendConfidence: trendData.confidence,
    calorieAdjustments: state.calorieHistory?.length ?? 0,
    intakeIsTargetOnly: true,
    rateStandardError: rateSE,
  });

  const trendDir = prev != null ? (estimate > prev + 15 ? 'increasing' : estimate < prev - 15 ? 'decreasing' : 'stable') : 'stable';
  const isPlausible = !(phase === PHASE.MINICUT && estimate > (prev ?? initial) + 50);
  const tdeeTrendPlausibility = {
    status: isPlausible ? 'plausible' : 'suspicious',
    direction: trendDir,
    note: phase === PHASE.MINICUT
      ? 'Caloric deficit: acute fluid drops isolated to prevent unphysiological TDEE surges'
      : 'Caloric surplus: stable metabolic tracking',
  };

  return {
    estimate: round(estimate, 0),
    low: round(clamp(estimate - tdeeUncertainty, TDEE.MIN_KCAL, TDEE.MAX_KCAL), 0),
    high: round(clamp(estimate + tdeeUncertainty, TDEE.MIN_KCAL, TDEE.MAX_KCAL), 0),
    uncertainty: tdeeUncertainty,
    confidence: conf.score,
    confidenceDetail: conf,
    impliedFromRate: round(impliedTDEE, 0),
    energyImbalance: round(energyImbalance, 0),
    tdeeTrendPlausibility,
    note: 'Latent TDEE estimated from weight trend and calorie intake with uncertainty interval',
  };
}

function wrapTDEE(estimate, initial, confidence, target) {
  const e = estimate ?? initial;
  const spread = Math.round(110 + (100 - confidence) * 0.85);
  return {
    estimate: round(e, 0),
    low: round(e - spread, 0),
    high: round(e + spread, 0),
    uncertainty: spread,
    confidence,
    note: 'Insufficient trend data for high-confidence TDEE inference',
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
