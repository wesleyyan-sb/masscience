/**
 * Masscience v2.4 — Phase Manager
 * 
 * Handles phase transitions:
 * - Recognizes when phase should change
 * - Manages expected transient effects (glycogen, water)
 * - Prevents false signals during transitions
 * - Protects against inappropriate calorie changes
 */

import { PHASE } from './constants.js';

/**
 * Track state across a phase transition
 * Initialized when phase changes, reset after transition is "settled"
 */
export class PhaseTransitionTracker {
  constructor(fromPhase, toPhase, day) {
    this.fromPhase = fromPhase;
    this.toPhase = toPhase;
    this.dayOfTransition = day;
    this.daysInNewPhase = 0;
    this.isSettled = false; // Transition effects mostly resolved
    
    // Expected transient dynamics
    this.expectedTransients = computeExpectedTransients(fromPhase, toPhase);
  }
  
  /**
   * Update tracker with each new day
   * Returns { isSettled, daysSinceTransition, expectedGlycopenWaterSwing }
   */
  update(day) {
    this.daysInNewPhase = day - this.dayOfTransition;
    
    // Transition is "settled" after ~7-10 days
    // By then, glycogen/water have mostly adjusted
    this.isSettled = this.daysInNewPhase >= 10;
    
    const expectedSwing = this.expectedTransients.initialSwing *
      Math.exp(-this.daysInNewPhase / this.expectedTransients.timeConstantDays);
    
    return {
      isSettled: this.isSettled,
      daysSinceTransition: this.daysInNewPhase,
      expectedTransientSwing: expectedSwing,
      isEarlyTransition: this.daysInNewPhase < 3, // Extra conservative during first 3 days
    };
  }
  
  /**
   * Should we suppress controller adjustments during early transition?
   */
  shouldSuppressAdjustment() {
    return this.daysInNewPhase < 3 && !this.isSettled;
  }
  
  /**
   * Adjust trend weight to remove transient effect for controller
   * Returns "tissue-level" weight for control feedback
   */
  denoiseForControl(trendWeight) {
    if (this.isSettled) return trendWeight;
    
    const expectedSwing = this.expectedTransients.initialSwing *
      Math.exp(-this.daysInNewPhase / this.expectedTransients.timeConstantDays);
    
    // Remove transient from trend weight to get tissue weight
    return trendWeight - expectedSwing;
  }
}

/**
 * Expected glycogen/water transient when switching phases
 */
function computeExpectedTransients(fromPhase, toPhase) {
  if (fromPhase === PHASE.BULK && toPhase === PHASE.MINICUT) {
    // Bulk → Minicut: large glycogen + water drop
    return {
      initialSwing: -0.70, // ~700g drop over first 7 days
      timeConstantDays: 2.8, // Exponential decay time constant
      direction: 'down',
    };
  }
  
  if (fromPhase === PHASE.MINICUT && toPhase === PHASE.BULK) {
    // Minicut → Bulk: glycogen + water restoration
    return {
      initialSwing: 0.65, // ~650g increase over first 7 days
      timeConstantDays: 3.0,
      direction: 'up',
    };
  }
  
  // Other transitions (unlikely)
  return {
    initialSwing: 0,
    timeConstantDays: 1,
    direction: 'none',
  };
}

/**
 * Detect if phase transition should occur
 * (Note: in simulation, phase is predetermined by schedule; in real app, might be user-triggered)
 */
export function shouldTransitionPhase(
  currentPhase,
  daysInPhase,
  scheduledPhases,
  currentPhaseIndex
) {
  if (currentPhaseIndex >= scheduledPhases.length - 1) return false;
  
  const currentSchedule = scheduledPhases[currentPhaseIndex];
  return daysInPhase >= currentSchedule.days;
}

/**
 * Get expected calorie shift for phase transition
 * Used for smooth ramping (spread over 3-5 days)
 */
export function getPhaseTransitionCalorieShift(
  fromPhase,
  toPhase,
  estimatedTDEE,
  profile
) {
  let targetShift = 0;
  
  if (fromPhase === PHASE.BULK && toPhase === PHASE.MINICUT) {
    // Reduce calories by roughly 15-25% of TDEE
    targetShift = -(estimatedTDEE * 0.20);
  } else if (fromPhase === PHASE.MINICUT && toPhase === PHASE.BULK) {
    // Increase calories by roughly 15-20% of TDEE
    targetShift = estimatedTDEE * 0.18;
  }
  
  // Clamp to reasonable bounds
  const maxShift = 500; // Don't shift by more than 500 kcal in total
  return Math.max(-maxShift, Math.min(maxShift, targetShift));
}

/**
 * Spread calorie shift over multiple days to avoid glycogen/water shock
 */
export function scheduleCalorieRamp(totalShift, rampDays = 4) {
  const deltas = [];
  const perDay = totalShift / rampDays;
  
  for (let i = 0; i < rampDays; i++) {
    // Front-load slightly: spend more on early days
    const weight = 1 + (rampDays - i) / rampDays * 0.2;
    deltas.push(Math.round(perDay * weight / (1 + 0.2)));
  }
  
  // Correct for rounding error on last day
  const sum = deltas.reduce((a, b) => a + b, 0);
  deltas[deltas.length - 1] += (totalShift - sum);
  
  return deltas;
}

/**
 * Assess if we're in the middle of a problematic phase transition
 * (e.g., glycogen is rapidly dropping, making weight signal noisy)
 */
export function isPhaseTransitionNoisy(
  transitionTracker,
  trendData
) {
  if (!transitionTracker || transitionTracker.isSettled) {
    return { isNoisy: false, reason: null };
  }
  
  const daysSince = transitionTracker.daysInNewPhase;
  const trendConfidence = trendData?.confidence ?? 50;
  
  // During first 7 days of transition, confidence naturally lower
  if (daysSince < 7) {
    // If we have LOW confidence during early transition, it's definitely noisy
    if (trendConfidence < 45) {
      return {
        isNoisy: true,
        reason: 'early_transition_low_confidence',
        daysSince,
      };
    }
  }
  
  // If in very early transition (< 3 days), always consider somewhat noisy
  if (daysSince < 3) {
    return {
      isNoisy: true,
      reason: 'very_early_transition',
      daysSince,
    };
  }
  
  return { isNoisy: false, reason: null };
}

/**
 * Adjust target rate for phase transition effects
 * During bulk→minicut transition, allow slower fat loss initially
 * because glycogen drop artificially inflates rate
 */
export function adjustTargetRateForTransition(
  baseTargetRate,
  transitionTracker,
  currentPhase
) {
  if (!transitionTracker || transitionTracker.isSettled) {
    return baseTargetRate;
  }
  
  const daysSince = transitionTracker.daysInNewPhase;
  
  if (transitionTracker.toPhase === PHASE.MINICUT) {
    // During minicut transition, observed rate includes glycogen + water loss
    // Adjust target slightly downward to account for transient
    const transientInflation = 0.15 * Math.exp(-daysSince / 3); // Decays over 3 days
    return baseTargetRate - transientInflation;
  }
  
  if (transitionTracker.toPhase === PHASE.BULK) {
    // During bulk transition, glycogen restoration creates false weight gain
    // Adjust target upward to account for this
    const transientInflation = 0.12 * Math.exp(-daysSince / 3);
    return baseTargetRate + transientInflation;
  }
  
  return baseTargetRate;
}

/**
 * Check if controller should make calorie adjustments during transition
 * Prevents panic responses to transient signals
 */
export function shouldSuppressControllerDuringTransition(
  transitionTracker,
  trendData,
  rateError
) {
  if (!transitionTracker || transitionTracker.isSettled) {
    return { shouldSuppress: false, reason: null };
  }
  
  const daysSince = transitionTracker.daysInNewPhase;
  const confidence = trendData?.confidence ?? 50;
  
  // During first 3 days: always suppress aggressive adjustments
  if (daysSince < 3) {
    return {
      shouldSuppress: true,
      reason: 'very_early_transition_suppress_all',
    };
  }
  
  // Days 3-7: suppress if error is small
  if (daysSince < 7 && Math.abs(rateError) < 0.15) {
    return {
      shouldSuppress: true,
      reason: 'early_transition_small_error',
    };
  }
  
  // If confidence is low during transition, don't trust the signal
  if (confidence < 50 && daysSince < 10) {
    return {
      shouldSuppress: true,
      reason: 'transition_low_confidence',
    };
  }
  
  return { shouldSuppress: false, reason: null };
}
