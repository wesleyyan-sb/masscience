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
    const daysSince = daysBetween(algorithmState.lastCalorieAdjustment, today());
    if (daysSince < CALORIES.ADJUSTMENT_COOLDOWN_DAYS) {
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
  const deadband = Math.max(
    CALORIES.DEADBAND_KG_PER_WEEK,
    (CALORIES.DEADBAND_PERCENT_BW_WEEK / 100) * (state.profile.weightKg || 70)
  );

  const rateError = actualRate - targetRate;
  const trajErr = trajectoryError?.errorKg ?? 0;
  const combinedError = rateError * 0.85 + (trajErr / Math.max(trajectoryError?.dayIndex || 14, 7)) * 0.15;

  if (Math.abs(combinedError) <= deadband && Math.abs(trajErr) < 0.12) {
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

  const confidence = trendData.confidence ?? 40;
  if (confidence < 45) {
    return {
      status: STATUS.NEUTRAL,
      message: 'Trend confidence too low for a calorie change. Log more weigh-ins.',
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      rateError: round(rateError, 3),
    };
  }

  const confWeight = clamp(confidence / 100, 0.5, 1);
  let adjustment = -selectStep(Math.abs(combinedError), phase) * Math.sign(combinedError) * confWeight;
  adjustment = round(adjustment, 0);

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
  const message = buildExplanation({ actualRate, targetRate, combinedError, confidence, adjustment, phase, trendData });

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

function selectStep(absError, phase) {
  let step = CALORIES.ADJUSTMENT_STEPS[0];
  if (absError > 0.06) step = CALORIES.ADJUSTMENT_STEPS[1];
  if (absError > 0.12) step = CALORIES.ADJUSTMENT_STEPS[2];
  if (absError > 0.20) step = CALORIES.ADJUSTMENT_STEPS[3];
  if (phase === PHASE.MINICUT) step = Math.min(step, 150);
  return step;
}

function deriveStatus(error, deadband, phase) {
  const abs = Math.abs(error);
  if (abs <= deadband * 2) return STATUS.GREEN;
  if (abs <= deadband * 4) return STATUS.YELLOW;
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
