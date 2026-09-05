/**
 * Masscience V2.1 — Control system (weight trajectory ONLY)
 * Composition/BF never directly changes calories — constraint/warning only.
 */
import { CALORIES, STATUS, PHASE } from './constants.js';
import { clamp, round, daysBetween, today } from './utils.js';

export function calculateCalorieAdjustment(state, trendData, gainRange, phase, trajectoryError) {
  const { algorithmState } = state;
  const currentCalories = algorithmState.currentCalories;

  if (!trendData?.rate?.perWeek || trendData.rate.insufficient) {
    return neutralResponse(currentCalories, 'Masscience is still learning your weight pattern.');
  }

  if (algorithmState.lastCalorieAdjustment) {
    const asOf = state.currentCycle?.currentDate || algorithmState.currentDate || trendData?.latest?.date || today();
    const daysSince = daysBetween(algorithmState.lastCalorieAdjustment, asOf);
    const cooldownDays = Math.max(CALORIES.ADJUSTMENT_COOLDOWN_DAYS ?? 14, 14);
    if (daysSince < cooldownDays) {
      return {
        status: STATUS.GREEN,
        message: 'Monitoring your response to the recent adjustment.',
        recommendedCalories: currentCalories,
        adjustment: 0,
        shouldAdjust: false,
        inCooldown: true,
      };
    }
  }

  const actualRate = trendData.rate.perWeek;
  const targetRate = gainRange.target;
  
  // 3-Tier Adaptive Transition Architecture:
  // Tier 1 (Days 1-10): Early transition. Rapid glycogen & water recharge/depletion.
  //   Suppress reflex cuts in bulk and reflex spikes in minicut from scale fluid jump.
  // Tier 2 (Days 11-21): Intermediate transition. Fluid has largely stabilized.
  //   Allow gentle damped corrections (max 75 kcal) to rein in real overshoots early without waiting 5 weeks.
  // Tier 3 (Days 22+): Sustained regime. Standard deadband & step adjustments.
  const daysSinceSwitch = algorithmState.daysSincePhaseSwitch ?? algorithmState.daysInPhase ?? 999;
  const isEarlyTransition = daysSinceSwitch <= 10;
  const isIntermediateTransition = daysSinceSwitch > 10 && daysSinceSwitch <= 21;
  const inTransition = isEarlyTransition || isIntermediateTransition;
  const rateSE = trendData.rate.standardError ?? 0.12;

  let deadband = Math.max(
    CALORIES.DEADBAND_KG_PER_WEEK,
    (CALORIES.DEADBAND_PERCENT_BW_WEEK / 100) * (state.profile.weightKg || 70),
    rateSE * 0.45
  );
  if (isEarlyTransition) {
    deadband *= 1.50; // Widen deadband during rapid initial fluid shifts
  } else if (isIntermediateTransition) {
    deadband *= 1.20; // Mild widening while settling
  }

  // Phase-Transition Stabilization Window (first 14 days of phase switch):
  // Rapid shifts in glycogen, digestive volume, and hydration contaminate the scale rate.
  // We reduce the control weight of rapid transient fluid shifts and place higher weight on accumulated energy balance.
  let effectiveActualRate = actualRate;
  if (daysSinceSwitch <= 14) {
    const stabilizationFactor = clamp(daysSinceSwitch / 14, 0.45, 1.0);
    if (phase === PHASE.MINICUT && actualRate < targetRate) {
      effectiveActualRate = targetRate + (actualRate - targetRate) * stabilizationFactor;
    } else if (phase === PHASE.BULK && actualRate > targetRate) {
      effectiveActualRate = targetRate + (actualRate - targetRate) * stabilizationFactor;
    }
  }

  const rateError = effectiveActualRate - targetRate;
  const trajErr = trajectoryError?.errorKg ?? 0;
  const combinedError = rateError * 0.85 + (trajErr / Math.max(trajectoryError?.dayIndex || 14, 7)) * 0.15;

  if (Math.abs(combinedError) <= deadband && Math.abs(trajErr) < 0.15) {
    return {
      status: STATUS.GREEN,
      message: 'Your weight trend matches the target trajectory.',
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      rateError: round(rateError, 3),
      trajectoryErrorKg: round(trajErr, 2),
      deadband: round(deadband, 3),
    };
  }

  // Phase transition confidence discount: avoid over-penalizing confidence during transition
  let rawConfidence = trendData.confidence ?? 40;
  if (isEarlyTransition) {
    const transitionFactor = clamp(0.55 + (daysSinceSwitch / 10) * 0.35, 0.55, 0.90);
    rawConfidence *= transitionFactor;
  }

  if (rawConfidence < 42) {
    return {
      status: STATUS.NEUTRAL,
      message: inTransition
        ? 'Phase transition in progress — allowing transient glycogen/water to settle.'
        : 'Trend confidence too low for a calorie change. Log more weigh-ins.',
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      rateError: round(rateError, 3),
      deadband: round(deadband, 3),
    };
  }

  const confWeight = clamp(rawConfidence / 100, 0.4, 1.0);
  let adjustment = -selectStep(Math.abs(combinedError), phase, inTransition) * Math.sign(combinedError) * confWeight;
  adjustment = round(adjustment, 0);

  // 3-Tier Transition Protection:
  // Tier 1 (Days 1-10): Freeze reflex cuts in bulk or reflex spikes in minicut from initial scale jump.
  if (isEarlyTransition && phase === PHASE.BULK && adjustment < 0) {
    adjustment = 0;
  }
  if (isEarlyTransition && phase === PHASE.MINICUT && adjustment > 0) {
    adjustment = 0;
  }

  // Tier 2 (Days 11-21): Damped corrections. If rate continues to overshoot, arrest it gently (max 75 kcal).
  if (isIntermediateTransition) {
    if (Math.abs(adjustment) > 75) {
      adjustment = Math.sign(adjustment) * 75;
    }
  }

  // Round to nearest 25 kcal increment
  if (Math.abs(adjustment) > 0) {
    adjustment = Math.round(adjustment / 25) * 25;
  }

  // Hysteresis: prevent rapid flip-flopping of calorie direction
  const lastAdjHistory = state.calorieHistory ?? [];
  const lastAdj = lastAdjHistory.length ? lastAdjHistory[lastAdjHistory.length - 1].adjustment : 0;
  if (lastAdj !== 0 && Math.sign(adjustment) !== Math.sign(lastAdj)) {
    // If reversing direction, require error > 1.5x deadband and suppress small reversal jitter
    if (Math.abs(combinedError) < deadband * 1.5 || Math.abs(adjustment) < 50) {
      adjustment = 0;
    }
  }

  if (Math.abs(adjustment) > 0 && Math.abs(adjustment) < CALORIES.ADJUSTMENT_STEPS[0]) {
    adjustment = adjustment > 0 ? CALORIES.ADJUSTMENT_STEPS[0] : -CALORIES.ADJUSTMENT_STEPS[0];
  }

  let recommended = clamp(
    currentCalories + adjustment,
    CALORIES.MIN_CALORIES_ABSOLUTE,
    CALORIES.MAX_CALORIES
  );
  recommended = applySafetyBounds(recommended, state.profile, phase);
  adjustment = recommended - currentCalories;

  const status = deriveStatus(combinedError, deadband, phase);
  const message = buildExplanation({ actualRate, targetRate, combinedError, confidence: Math.round(rawConfidence), adjustment, phase, trendData });

  return {
    status,
    message,
    recommendedCalories: recommended,
    adjustment,
    shouldAdjust: adjustment !== 0,
    rateError: round(rateError, 3),
    trajectoryErrorKg: round(trajErr, 2),
    confidenceWeight: round(confWeight, 2),
    reasoning: message,
    controlSignal: 'weight_trajectory_only',
  };
}

function selectStep(absError, phase, inTransition = false) {
  let step = CALORIES.ADJUSTMENT_STEPS[0];
  if (absError > 0.08) step = CALORIES.ADJUSTMENT_STEPS[1];
  if (absError > 0.16) step = CALORIES.ADJUSTMENT_STEPS[2];
  if (absError > 0.25) step = CALORIES.ADJUSTMENT_STEPS[3];
  if (phase === PHASE.MINICUT || inTransition) step = Math.min(step, 100);
  return step;
}

function deriveStatus(error, deadband, phase) {
  const abs = Math.abs(error);
  if (abs <= deadband * 1.8) return STATUS.GREEN;
  if (abs <= deadband * 3.5) return STATUS.YELLOW;
  return STATUS.RED;
}

function buildExplanation(ctx) {
  const { actualRate, targetRate, confidence, adjustment, trendData } = ctx;
  const weeks = trendData?.rate?.windowDays ? Math.round(trendData.rate.windowDays / 7) : 2;
  const confLabel = confidence >= 72 ? 'high' : confidence >= 55 ? 'moderate' : 'low';
  if (!adjustment) return `Trend ~${round(actualRate, 2)} kg/wk vs target ~${round(targetRate, 2)} kg/wk — within deadband.`;
  const dir = adjustment < 0 ? 'reducing' : 'increasing';
  return `Over ~${weeks} weeks, trend rate is ~${round(actualRate, 2)} kg/wk vs target ~${round(targetRate, 2)} kg/wk. Confidence: ${confLabel}. Recommend ${dir} target by ~${Math.abs(adjustment)} kcal. One weigh-in does not change the plan.`;
}

function neutralResponse(calories, message) {
  return { status: STATUS.NEUTRAL, message, recommendedCalories: calories, adjustment: 0, shouldAdjust: false };
}

function applySafetyBounds(calories, profile, phase) {
  const min = profile.sex === 'male' ? CALORIES.MIN_CALORIES_MALE : CALORIES.MIN_CALORIES_FEMALE;
  return clamp(calories, min, CALORIES.MAX_CALORIES);
}

/** Simulate closed-loop controller stability */
export function simulateController(initialCalories, tdee, targetRate, actualGainPer100kcal, weeks = 8) {
  let calories = initialCalories;
  let rate = (initialCalories - tdee) / 1000 * 0.15;
  const history = [];

  for (let w = 0; w < weeks; w++) {
    const error = rate - targetRate;
    history.push({ week: w, calories, rate, error });
    if (Math.abs(error) <= 0.025) continue;
    const adj = -Math.sign(error) * (Math.abs(error) > 0.12 ? 100 : 50);
    calories = clamp(calories + adj, 1500, 4000);
    rate = (calories - tdee) / 1000 * actualGainPer100kcal;
  }
  return history;
}
