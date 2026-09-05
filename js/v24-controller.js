/**
 * Masscience v2.4 — Improved Closed-Loop Controller
 * 
 * PI-style controller with:
 * - State-based feedback (tissue weight, not raw trend weight)
 * - Confidence-aware gains
 * - Rate limiting + anti-windup
 * - Hysteresis to prevent oscillation
 * - Phase-transition awareness
 * - Explicit safeguards
 */

import { CALORIES, STATUS, PHASE } from './constants.js';
import { clamp, round } from './utils.js';

/**
 * Main controller: Calculate calorie adjustment
 * 
 * Input:
 *  - state: controller state (previous estimate, confidence, etc)
 *  - trendData: weight trend + confidence
 *  - tissueWeight: estimated tissue weight (not raw trend)
 *  - targetRate: desired weight change rate (kg/week)
 *  - phase: current phase
 *  - daysSinceLastAdjustment: when was last calorie change
 * 
 * Output: { recommendedCalories, adjustment, shouldAdjust, status, message }
 */
export function controllerCalorieAdjustment(
  currentCalories,
  tissueRate,
  targetRate,
  confidence,
  phase,
  lastAdjustmentAge = 999,
  controllerState = {}
) {
  // ---- INSUFFICIENT DATA ----
  if (confidence < 40) {
    return {
      status: STATUS.NEUTRAL,
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      message: 'Confidence too low for adjustment. Log more weigh-ins.',
      reason: 'low_confidence',
    };
  }

  // ---- COOLDOWN PERIOD ----
  const minDaysBetweenAdjustments = phase === PHASE.MINICUT ? 5 : 7;
  if (lastAdjustmentAge < minDaysBetweenAdjustments) {
    return {
      status: STATUS.GREEN,
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      message: `Monitoring response to recent adjustment (${minDaysBetweenAdjustments - lastAdjustmentAge} days until next possible adjustment).`,
      reason: 'cooldown_active',
      daysSinceLastAdjustment: lastAdjustmentAge,
    };
  }

  // ---- RATE ERROR ----
  const rateError = tissueRate - targetRate;
  
  // Deadband: no adjustment if error is small
  // Depends on confidence: high confidence → tighter deadband
  const deadband = computeDeadband(confidence, phase);
  
  if (Math.abs(rateError) <= deadband) {
    return {
      status: STATUS.GREEN,
      recommendedCalories: currentCalories,
      adjustment: 0,
      shouldAdjust: false,
      message: `Tissue rate ${round(tissueRate, 3)} kg/week matches target ${round(targetRate, 3)} kg/week (within deadband).`,
      reason: 'within_deadband',
      rateError: round(rateError, 3),
      deadband: round(deadband, 3),
    };
  }

  // ---- COMPUTE ADJUSTMENT ----
  const confidenceGain = clamp(confidence / 60, 0.3, 1.2); // PI controller gain
  const phaseGain = phase === PHASE.MINICUT ? 0.9 : 1.0; // Slightly conservative on minicut
  
  // P (proportional) term: respond to current error
  const pTerm = -rateError * 7 * CALORIES.KCAL_PER_KG * confidenceGain * phaseGain;
  
  // I (integral) term: accumulated error (from controller state)
  const prevIntegral = controllerState.errorIntegral ?? 0;
  const newIntegral = clamp(prevIntegral + rateError * 0.3, -0.5, 0.5); // Anti-windup
  const iTerm = -newIntegral * 3 * CALORIES.KCAL_PER_KG * confidenceGain * phaseGain;
  
  let adjustment = pTerm + iTerm;
  
  // ---- RATE LIMITING ----
  const maxAdj = phase === PHASE.MINICUT ? 200 : 250; // Max adjustment per cycle
  adjustment = clamp(adjustment, -maxAdj, maxAdj);
  
  // Round to sensible increments
  if (Math.abs(adjustment) > 0) {
    adjustment = Math.round(adjustment / 25) * 25;
  }
  
  // ---- HYSTERESIS (prevent oscillation) ----
  const prevAdjustment = controllerState.lastAdjustment ?? 0;
  if (Math.abs(adjustment) > 0 && Math.sign(adjustment) !== Math.sign(prevAdjustment)
      && Math.abs(adjustment) < 75) {
    // If we're oscillating and the new adjustment is small, suppress it
    adjustment = 0;
  }
  
  // ---- SAFETY BOUNDS ----
  let recommended = clamp(
    currentCalories + adjustment,
    phase === PHASE.MINICUT ? 1400 : 1600,
    4500
  );
  
  // Apply phase-specific safety bounds
  if (phase === PHASE.MINICUT) {
    // Minicut: ensure minimum lean-mass protection
    // Max loss rate: 1% per week for intermediate/advanced trainees
    // Corresponds to ~500-700 kcal deficit per day
    const minDailyCalories = 1400; // Absolute floor
    recommended = Math.max(recommended, minDailyCalories);
  } else {
    // Bulk: don't exceed reasonable surplus
    const maxDailyCalories = 4000; // Absolute ceiling
    recommended = Math.min(recommended, maxDailyCalories);
  }
  
  // Final adjustment (accounting for safety bounds)
  adjustment = recommended - currentCalories;
  
  // ---- STATUS & MESSAGE ----
  const status = deriveStatusV24(rateError, deadband, phase, confidence);
  const message = buildControllerMessage(rateError, targetRate, adjustment, confidence);
  
  return {
    status,
    recommendedCalories: recommended,
    adjustment,
    shouldAdjust: Math.abs(adjustment) > 0,
    message,
    rateError: round(rateError, 3),
    deadband: round(deadband, 3),
    pTerm: round(pTerm, 0),
    iTerm: round(iTerm, 0),
    confidence,
    controllerStateUpdate: {
      errorIntegral: newIntegral,
      lastAdjustment: adjustment,
    },
  };
}

/**
 * Compute adaptive deadband based on confidence and phase
 */
function computeDeadband(confidence, phase) {
  // Base deadband
  const baseDeadband = phase === PHASE.MINICUT ? 0.09 : 0.10;
  
  // Tighten deadband as confidence increases
  // Low confidence (40) → wide deadband 0.15 kg/week
  // High confidence (80+) → tight deadband 0.05 kg/week
  const confidenceAdj = clamp((confidence - 40) / 40 * -0.05, -0.05, 0);
  
  return clamp(baseDeadband + confidenceAdj, 0.05, 0.15);
}

/**
 * Derive control status from rate error
 */
function deriveStatusV24(rateError, deadband, phase, confidence) {
  const absError = Math.abs(rateError);
  
  // Green: Within deadband
  if (absError <= deadband) return STATUS.GREEN;
  
  // Yellow: Moderate error
  if (absError <= deadband * 3 && confidence >= 50) return STATUS.YELLOW;
  
  // Red: Large error or low confidence with error
  return STATUS.RED;
}

/**
 * Build human-readable message
 */
function buildControllerMessage(rateError, targetRate, adjustment, confidence) {
  const direction = adjustment > 0 ? 'increasing' : 'decreasing';
  const magnitude = Math.abs(adjustment);
  
  if (adjustment === 0) {
    return `Tissue rate matches target. No adjustment needed.`;
  }
  
  const confLabel = confidence >= 70 ? 'high' : confidence >= 50 ? 'moderate' : 'low';
  
  return `Rate error: ${round(rateError, 3)} kg/week. ` +
         `Recommending ${direction} calories by ${Math.round(magnitude)} kcal/day ` +
         `(confidence: ${confLabel}).`;
}

/**
 * Safeguard: Check if calorie adjustment would exceed physiological limits
 */
export function checkSafetyLimits(
  recommendedCalories,
  phase,
  profile,
  currentTissueWeight,
  currentBf
) {
  const warnings = [];
  const errors = [];
  
  // Sex-specific minimums
  const minCalories = profile.sex === 'male' ? 1600 : 1400;
  if (recommendedCalories < minCalories) {
    errors.push(`Calorie target (${recommendedCalories} kcal) below safe minimum for ${profile.sex}. Consider larger deficit.`);
  }
  
  // Phase-specific checks
  if (phase === PHASE.MINICUT) {
    // Minicut: check max loss rate
    // ~0.5-1.0% BW per week is reasonable
    const maxWeeklyLossPercent = 1.0;
    const maxWeeklyLossKg = (currentTissueWeight * maxWeeklyLossPercent) / 100;
    const impliedWeeklyLoss = (recommendedCalories - 2500) * 7 / 7700; // Rough estimate
    
    if (impliedWeeklyLoss < -maxWeeklyLossKg) {
      warnings.push(`Very aggressive deficit may exceed safe loss rate (${round(maxWeeklyLossKg, 2)} kg/week).`);
    }
    
    // Body fat check: don't allow minicut if very lean
    if (currentBf < 7) {
      warnings.push('Body fat appears very low. Minicut may risk excessive lean loss.');
    }
  } else if (phase === PHASE.BULK) {
    // Bulk: check max gain rate
    // ~0.5-1.0% BW per week is reasonable
    const maxWeeklyGainPercent = 1.0;
    const maxWeeklyGainKg = (currentTissueWeight * maxWeeklyGainPercent) / 100;
    const impliedWeeklyGain = (recommendedCalories - 2500) * 7 / 7700;
    
    if (impliedWeeklyGain > maxWeeklyGainKg) {
      warnings.push(`Surplus may exceed optimal gain rate (${round(maxWeeklyGainKg, 2)} kg/week).`);
    }
  }
  
  // Absolute bounds
  if (recommendedCalories < 1000 || recommendedCalories > 5000) {
    errors.push(`Calorie target (${recommendedCalories} kcal) is outside physiologically reasonable bounds.`);
  }
  
  return { warnings, errors, isValid: errors.length === 0 };
}

/**
 * Check for controller oscillation (sign reversal in recent adjustments)
 */
export function detectControllerOscillation(adjustmentHistory, windowSize = 5) {
  if (adjustmentHistory.length < windowSize) return { oscillating: false, count: 0 };
  
  const recent = adjustmentHistory.slice(-windowSize);
  const nonzeroChanges = recent.filter(adj => Math.abs(adj) > 25);
  
  if (nonzeroChanges.length < 2) return { oscillating: false, count: 0 };
  
  let oscillations = 0;
  for (let i = 1; i < nonzeroChanges.length; i++) {
    if (Math.sign(nonzeroChanges[i]) !== Math.sign(nonzeroChanges[i - 1])) {
      oscillations++;
    }
  }
  
  return {
    oscillating: oscillations >= 2,
    count: oscillations,
    severity: oscillations / nonzeroChanges.length,
  };
}
