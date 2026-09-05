/**
 * Masscience v2.4 — Improved State Estimator
 * 
 * Estimates latent state:
 * - Tissue-level weight (fat + lean mass, excluding glycogen/water/digestive)
 * - Body fat fraction
 * - TDEE (baseline + adaptive)
 * - Confidence/uncertainty
 * 
 * Separates transient (water, glycogen) from persistent (tissue) changes.
 * Uses EMA-style filtering with phase-transition awareness.
 */

import { PHASE } from './constants.js';
import { clamp, round } from './utils.js';
import { calculateTDEEConfidence } from './confidence.js';

const KCAL_PER_KG_TISSUE = 7700; // Approximate weighted avg of fat + lean

/**
 * Recursive tissue weight estimator
 * Infers true tissue weight (fat + lean) from:
 * - Trend weight (includes glycogen/water noise)
 * - Energy intake
 * - Energy expenditure (TDEE estimate)
 * - Phase (affects expected glycogen/water)
 */
export function updateTissueWeight(
  prevTissueWeight,
  trendWeight,
  energyBalanceKcal,
  daysSincePhaseChange,
  phase,
  confidence,
  options = {}
) {
  const maxDailyTissueChange = 0.012; // ~85g/day max tissue change
  const minGlycopenWaterPerWeek = 0.5; // Minimum expected transient swing
  
  // Expected glycogen/water dynamics
  const expectedTransientSwing = estimateExpectedTransient(
    phase,
    daysSincePhaseChange,
    energyBalanceKcal
  );
  
  // Implied tissue weight from energy balance
  // Energy deficit/surplus → tissue change
  const impliedTissueChange = energyBalanceKcal / KCAL_PER_KG_TISSUE;
  
  // Trend weight change includes transients
  const observedWeightChange = trendWeight - (prevTissueWeight + expectedTransientSwing);
  
  // Kalman-style update with confidence weighting
  // High confidence in trend → trust it more
  // Low confidence → trust model more
  const confidenceWeight = clamp(confidence / 100, 0.3, 0.9);
  
  // Blend observed change (from trend) with model-predicted change (from EB)
  const blendedTissueChange = (
    observedWeightChange * confidenceWeight +
    impliedTissueChange * (1 - confidenceWeight)
  );
  
  // Rate limit: don't change too fast
  const clampedChange = clamp(
    blendedTissueChange,
    -maxDailyTissueChange,
    maxDailyTissueChange
  );
  
  return Number((prevTissueWeight + clampedChange).toFixed(3));
}

/**
 * Expected glycogen/water transient swing based on phase
 * Returns expected change from "normal" (used to isolate tissue from trend)
 */
function estimateExpectedTransient(phase, daysSincePhaseChange, energyBalanceKcal) {
  let baseSwing = 0;
  
  if (phase === PHASE.MINICUT) {
    if (daysSincePhaseChange < 7) {
      // Early minicut: glycogen drops rapidly (~0.3 kg) + water follows (~0.4 kg)
      const progress = Math.min(daysSincePhaseChange / 7, 1);
      baseSwing = -(0.3 + 0.4) * Math.pow(progress, 1.2);
    }
  } else if (phase === PHASE.BULK) {
    if (daysSincePhaseChange < 7) {
      // Early bulk: glycogen restores (~0.2 kg) + water follows (~0.3 kg)
      const progress = Math.min(daysSincePhaseChange / 7, 1);
      baseSwing = (0.2 + 0.3) * Math.pow(progress, 1.2);
    }
  }
  
  // Energy balance also drives water: ~0.3-0.5 kg per 500 kcal
  const waterFromEB = energyBalanceKcal > 0
    ? Math.min(energyBalanceKcal / 1500, 0.15)
    : Math.max(energyBalanceKcal / 2000, -0.20);
  
  return baseSwing + waterFromEB;
}

/**
 * Recursive body-fat estimator — IMPROVED v2.4.1
 * 
 * Infers BF from tissue weight + trend weight
 * Uses Bayesian blend of prior BF and observed weight changes
 * 
 * Key improvements:
 * 1. Inverted alpha logic: low confidence → MORE smoothing (not less)
 * 2. Uses trend weight delta (less filtered) instead of tissue delta
 * 3. Separate P-ratio calculation path to avoid feedback loops
 */
export function updateBodyFatEstimate(
  prevBfPercent,
  tissueWeight,
  prevTissueWeight,
  trendWeight,
  prevTrendWeight,
  phase,
  trainingYears,
  confidence,
  options = {}
) {
  // Use tissue weight delta (from updateTissueWeight, cleaner signal)
  // This is already separated from glycogen/water transients
  const tissueWeightDelta = tissueWeight - prevTissueWeight;
  
  // For better P-ratio estimation, use conservative baseline
  const pRatioContextBf = clamp(prevBfPercent, 6, 25);
  
  // P-ratio: fraction of tissue change that is fat (vs lean)
  const pRatio = estimatePRatioFromContext(
    phase,
    trainingYears,
    pRatioContextBf,
    tissueWeightDelta > 0
  );
  
  // Fat mass change from tissue change (using tissue delta, not trend delta)
  const fatChange = tissueWeightDelta * pRatio;
  
  // Current fat mass (computed from previous weight + previous BF%)
  const prevFatMass = (prevTrendWeight / 100) * prevBfPercent;
  
  // New fat mass after this week
  const newFatMass = prevFatMass + fatChange;
  
  // Compute implied BF (using current trend weight)
  const impliedBf = (newFatMass / trendWeight) * 100;
  
  // Apply conservative smoothing (lower alpha values to prevent drift)
  // Low confidence → more smoothing; High confidence → less smoothing
  const confidenceAdjusted = clamp(confidence / 100, 0.2, 1.0);
  const alpha = clamp((1 - confidenceAdjusted) * 0.20, 0.02, 0.12);
  const smoothedBf = prevBfPercent + alpha * (impliedBf - prevBfPercent);
  
  // Bounds checking: realistic BF limits
  return clamp(smoothedBf, 4, 40);
}

/**
 * P-ratio estimator — IMPROVED v2.4.1
 * 
 * Fraction of tissue weight change that is fat (vs lean)
 * 
 * Improvements:
 * 1. Smooth transitions across training age (no plateaus)
 * 2. Gentle BF effects (avoid extreme values)
 * 3. Conservative defaults that don't amplify feedback loops
 */
function estimatePRatioFromContext(phase, trainingYears, contextBf, isSurplus) {
  // Base ratio: ~50% fat gain in surplus, ~65% fat loss in deficit
  let baseRatio = isSurplus ? 0.50 : 0.65;
  
  // Training age effect — smooth transition instead of plateaus
  // Year 0: 0.55 (novice)
  // Year 2: 0.50 (intermediate)
  // Year 5+: 0.45 (advanced)
  const trainingAgeEffect = isSurplus
    ? -0.025 * Math.min(trainingYears, 5)  // Gradually more lean-focused
    : 0.025 * Math.min(trainingYears, 5);   // Gradually more fat-sparing
  baseRatio = clamp(baseRatio + trainingAgeEffect, 0.35, 0.70);
  
  // BF level effect — more conservative to avoid feedback loops
  // Very lean (< 8%): slight preference for muscle, but not extreme
  // High BF (> 20%): more fat available, but not complete
  if (contextBf < 8) {
    baseRatio = isSurplus ? 0.45 : 0.75;
  } else if (contextBf > 20) {
    baseRatio = isSurplus ? 0.55 : 0.60;
  }
  // Otherwise use training-adjusted base
  
  // Phase effect: during minicut, increase lean-sparing
  if (phase === PHASE.MINICUT) {
    baseRatio = Math.max(baseRatio - 0.12, 0.40);
  }
  
  return clamp(baseRatio, 0.25, 0.85);
}

/**
 * Recursive TDEE estimator (Kalman-style) — IMPROVED v2.4.2
 * 
 * More aggressive learning to better track TDEE changes
 * Calibrated for faster convergence during phase transitions
 */
export function updateTDEEEstimate(
  prevTdeeEstimate,
  calorieIntake,
  trendWeightDeltaKg,    // use trend delta for better signal
  daysSinceLastUpdate,   // typically 7 days
  confidence,
  phase = null,
  options = {}
) {
  // More aggressive calibration for better TDEE learning
  const tdeeLearningRateBase = 0.25;  // Increased from 0.18
  const maxTdeeShiftPerDay = 30;      // Increased from 20 (allow faster phase transition adaptation)
  
  // Implied TDEE from trend weight change
  const energyBalance = trendWeightDeltaKg * KCAL_PER_KG_TISSUE;
  const impliedTDEE = calorieIntake - energyBalance;
  
  // Apply confidence weighting BEFORE rate limiting (high confidence can move faster)
  const confidenceWeight = clamp(confidence / 100, 0.3, 1.0);
  const confidenceAdjustedImplied = prevTdeeEstimate + 
    (impliedTDEE - prevTdeeEstimate) * confidenceWeight;
  
  // Rate-limit the confidence-adjusted estimate
  const maxShift = maxTdeeShiftPerDay * daysSinceLastUpdate;
  const boundedShift = clamp(
    confidenceAdjustedImplied - prevTdeeEstimate,
    -maxShift,
    maxShift
  );
  
  // Learning rate applied to bounded shift
  const update = boundedShift * tdeeLearningRateBase;
  
  const newTdee = prevTdeeEstimate + update;
  
  // Sanity bounds
  return clamp(newTdee, 1500, 4500);
}

/**
 * Compute confidence score for the state estimate
 * Based on: trend data quality, observation span, tissue stability
 */
export function computeStateConfidence(trendData, tissueTrendHistory, options = {}) {
  let score = 0;
  
  // Trend confidence contributes 50 points
  const trendConfidence = trendData?.confidence ?? 30;
  score += (trendConfidence / 100) * 50;
  
  // Tissue trend stability contributes 30 points
  // If tissue weight is bouncing around, confidence is lower
  if (tissueTrendHistory && tissueTrendHistory.length >= 5) {
    const recentChanges = [];
    for (let i = 1; i < Math.min(5, tissueTrendHistory.length); i++) {
      recentChanges.push(
        tissueTrendHistory[tissueTrendHistory.length - i] -
        tissueTrendHistory[tissueTrendHistory.length - i - 1]
      );
    }
    const volatility = Math.sqrt(
      recentChanges.reduce((a, x) => a + x * x, 0) / recentChanges.length
    );
    // Low volatility (< 0.01 kg/day) → high confidence
    const stabilityScore = clamp(1 - volatility / 0.015, 0, 1) * 30;
    score += stabilityScore;
  }
  
  // Observation count contributes 20 points
  const measuredDays = trendData?.measuredCount ?? 0;
  score += Math.min(measuredDays / 30, 1) * 20;
  
  return clamp(Math.round(score), 0, 100);
}

/**
 * Produce uncertainty bounds for estimates
 */
export function computeUncertaintyBounds(estimate, confidence, estimateType = 'bf') {
  // Base uncertainty widens as confidence drops
  const confidenceWeight = clamp(confidence / 100, 0.2, 1.0);
  
  let baseUncertainty;
  if (estimateType === 'bf') {
    baseUncertainty = clamp(2.0 * (1 - confidenceWeight), 0.5, 2.5);
  } else if (estimateType === 'tdee') {
    baseUncertainty = clamp(150 * (1 - confidenceWeight), 50, 300);
  } else if (estimateType === 'fat_mass') {
    baseUncertainty = clamp(0.8 * (1 - confidenceWeight), 0.2, 1.2);
  } else {
    baseUncertainty = 1.0 * (1 - confidenceWeight);
  }
  
  return {
    low: estimate - baseUncertainty,
    high: estimate + baseUncertainty,
    uncertainty: baseUncertainty,
  };
}
