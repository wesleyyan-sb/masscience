/**
 * Masscience V2 — Metabolic & body composition calculations
 */
import {
  ACTIVITY_MULTIPLIERS, MACROS, WATER, BODY_COMP, GAIN_RATE, CYCLE, CALORIES, PHASE,
} from './constants.js';
import { clamp, round } from './utils.js';
import { estimateBodyComposition } from './composition.js';

export function calculateBMR(profile) {
  const { sex, weightKg, heightCm, age } = profile;
  if (sex === 'male') {
    return 10 * weightKg + 6.25 * heightCm - 5 * age + 5;
  }
  return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
}

export function calculateTDEE(bmr, activityLevel) {
  return bmr * (ACTIVITY_MULTIPLIERS[activityLevel] || 1.55);
}

export function calculateInitialTDEE(profile) {
  const bmr = calculateBMR(profile);
  const estimate = calculateTDEE(bmr, profile.activityLevel);
  return {
    estimate: round(estimate, 0),
    low: round(estimate * 0.9, 0),
    high: round(estimate * 1.1, 0),
    confidence: 25,
    source: 'mifflin_activity',
  };
}

/** Macros reconcile exactly to calorie target */
export function calculateMacros(calories, weightKg) {
  const proteinG = MACROS.PROTEIN_G_PER_KG.target * weightKg;
  let proteinKcal = proteinG * 4;

  const fatFromWeight = MACROS.FAT_G_PER_KG.target * weightKg;
  const fatFromPercent = (calories * MACROS.FAT_MIN_KCAL_PERCENT) / 9;
  let fatG = Math.max(fatFromWeight, fatFromPercent);
  let fatKcal = fatG * 9;

  let carbKcal = calories - proteinKcal - fatKcal;
  if (carbKcal < 0) {
    fatG = Math.max(MACROS.FAT_G_PER_KG.min * weightKg, (calories * 0.15) / 9);
    fatKcal = fatG * 9;
    carbKcal = Math.max(0, calories - proteinKcal - fatKcal);
  }

  const carbG = carbKcal / 4;
  const total = proteinG * 4 + fatG * 9 + carbG * 4;

  return {
    calories: Math.round(calories),
    protein: Math.round(proteinG),
    fat: Math.round(fatG),
    carbs: Math.round(carbG),
    ranges: {
      protein: {
        min: Math.round(MACROS.PROTEIN_G_PER_KG.min * weightKg),
        target: Math.round(MACROS.PROTEIN_G_PER_KG.target * weightKg),
        max: Math.round(MACROS.PROTEIN_G_PER_KG.max * weightKg),
      },
    },
    reconciledTotal: Math.round(total),
  };
}

export function calculateWaterTarget(weightKg, trainingSessions, activityLevel = 'moderately_active') {
  const base = WATER.BASE_ML_PER_KG * weightKg;
  const training = trainingSessions * WATER.TRAINING_BONUS_ML;
  const activity = WATER.ACTIVITY_BONUS[activityLevel] || 0;
  const total = base + training + activity;
  return {
    ml: Math.round(total),
    display: round(total / 1000, 1),
    note: 'Approximate hydration guide — not a medical prescription',
  };
}

export function compositionFromBF(weightKg, bfPercent) {
  const fatMass = weightKg * (bfPercent / 100);
  const leanMass = weightKg - fatMass;
  return { fatMass, leanMass };
}

export function compositionRange(weightKg, bfEstimate) {
  const low = compositionFromBF(weightKg, bfEstimate.high);
  const mid = compositionFromBF(weightKg, bfEstimate.estimate);
  const high = compositionFromBF(weightKg, bfEstimate.low);
  return {
    fatMass: { low: round(low.fatMass, 1), mid: round(mid.fatMass, 1), high: round(high.fatMass, 1) },
    leanMass: { low: round(low.leanMass, 1), mid: round(mid.leanMass, 1), high: round(high.leanMass, 1) },
    note: 'Lean mass ≠ skeletal muscle',
  };
}

export function calculateFFMI(leanMassKg, heightCm) {
  const heightM = heightCm / 100;
  return leanMassKg / (heightM * heightM);
}

export function navyBodyFat(sex, waistCm, neckCm, heightCm, hipCm = null) {
  if (!waistCm || !neckCm) return null;
  if (sex === 'male') {
    const logVal = waistCm - neckCm;
    if (logVal <= 0) return null;
    const bf = 495 / (1.0324 - 0.19077 * Math.log10(logVal) + 0.15456 * Math.log10(heightCm)) - 450;
    return clamp(bf, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF);
  }
  if (!hipCm) return null;
  const logVal = waistCm + hipCm - neckCm;
  if (logVal <= 0) return null;
  const bf = 495 / (1.29579 - 0.35004 * Math.log10(logVal) + 0.22100 * Math.log10(heightCm)) - 450;
  return clamp(bf, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF);
}

/** Delegates to composition system (V2.1) */
export function estimateBodyFat(profile, trendData, bodyMeasurements = [], algorithmState = {}) {
  return estimateBodyComposition(profile, trendData, bodyMeasurements, algorithmState).bf;
}

/** Target gain as % bodyweight/week → kg/week */
export function recommendedGainRange(profile, phase, currentWeightKg) {
  const weight = currentWeightKg || profile.weightKg;
  const { trainingYears, bodyFatPercent } = profile;

  if (phase === PHASE.MINICUT) {
    const targetPct = GAIN_RATE.MINICUT_PCT_TARGET;
    const targetKg = -(targetPct / 100) * weight;
    return {
      min: -(GAIN_RATE.MINICUT_PCT_MAX / 100) * weight,
      max: -(GAIN_RATE.MINICUT_PCT_MIN / 100) * weight,
      target: round(targetKg, 3),
      targetPercent: -targetPct,
      minPercent: -GAIN_RATE.MINICUT_PCT_MAX,
      maxPercent: -GAIN_RATE.MINICUT_PCT_MIN,
      rationale: 'Conservative minicut ~0.4–1.0% BW/week loss',
    };
  }

  let pctMin = GAIN_RATE.BASE_PCT_MIN;
  let pctMax = GAIN_RATE.BASE_PCT_MAX;
  let pctTarget = GAIN_RATE.BASE_PCT_TARGET;

  if (trainingYears >= 5) {
    pctMin -= GAIN_RATE.ADVANCED_PCT_PENALTY;
    pctMax -= GAIN_RATE.ADVANCED_PCT_PENALTY;
    pctTarget -= GAIN_RATE.ADVANCED_PCT_PENALTY;
  } else if (trainingYears < 2) {
    pctMin += GAIN_RATE.NOVICE_PCT_BONUS;
    pctMax += GAIN_RATE.NOVICE_PCT_BONUS;
    pctTarget += GAIN_RATE.NOVICE_PCT_BONUS;
  }

  if (bodyFatPercent < 12) {
    pctMin += GAIN_RATE.LOW_BF_PCT_BONUS;
    pctMax += GAIN_RATE.LOW_BF_PCT_BONUS;
  } else if (bodyFatPercent > 18) {
    pctMin -= GAIN_RATE.HIGH_BF_PCT_PENALTY;
    pctMax -= GAIN_RATE.HIGH_BF_PCT_PENALTY;
  }

  pctMin = clamp(pctMin, 0.12, 0.55);
  pctMax = clamp(pctMax, pctMin + 0.05, 0.65);
  pctTarget = clamp(pctTarget, pctMin, pctMax);

  return {
    min: round((pctMin / 100) * weight, 3),
    max: round((pctMax / 100) * weight, 3),
    target: round((pctTarget / 100) * weight, 3),
    minPercent: round(pctMin, 2),
    maxPercent: round(pctMax, 2),
    targetPercent: round(pctTarget, 2),
    rationale: 'Target derived from % bodyweight/week (training age & BF adjusted)',
  };
}

export function maxBulkBodyFat(initialBf, bulkWeeks, gainRange, partitionMid) {
  const avgGainKg = gainRange.target * bulkWeeks;
  const fatGainKg = avgGainKg * partitionMid;
  const weightAssumed = 75;
  const bfIncrease = (fatGainKg / weightAssumed) * 100;
  const ceiling = initialBf + bfIncrease + 1.5;
  return {
    point: round(clamp(ceiling, initialBf + 0.5, 25), 1),
    low: round(initialBf + bfIncrease * 0.6, 1),
    high: round(initialBf + bfIncrease * 1.4 + 2, 1),
    note: 'Heuristic ceiling — not a guarantee',
  };
}

export function initialCalorieTarget(tdee, phase) {
  if (phase === PHASE.MINICUT) return tdee - CALORIES.INITIAL_MINICUT_DEFICIT;
  return tdee + CALORIES.INITIAL_BULK_SURPLUS;
}

function rangeMid(r) {
  return (r.min + r.max) / 2;
}

export function partitionWeightChange(weightChangeKg, phase, options = {}) {
  const daysInPhase = options.daysInPhase ?? 999;

  if (phase === PHASE.MINICUT) {
    const isEarly = daysInPhase <= BODY_COMP.MINICUT_EARLY_DAYS;
    const ranges = isEarly ? BODY_COMP.MINICUT_EARLY : BODY_COMP.MINICUT_STEADY;
    const fat = rangeMid(ranges.fat);
    const lean = rangeMid(ranges.lean);
    const water = Math.max(0.02, 1 - fat - lean);
    const sum = fat + lean + water;
    return {
      fatChange: weightChangeKg * (fat / sum),
      leanChange: weightChangeKg * (lean / sum),
      waterChange: weightChangeKg * (water / sum),
      phase: isEarly ? 'minicut_early' : 'minicut_steady',
    };
  }

  const trainingYears = options.trainingYears ?? 3;
  const bf = options.bodyFatPercent ?? 15;
  let leanFrac = BODY_COMP.BULK_LEAN_FRAC.mid;
  if (trainingYears < 2) leanFrac = BODY_COMP.BULK_LEAN_FRAC.max;
  if (trainingYears >= 5) leanFrac = BODY_COMP.BULK_LEAN_FRAC.min;
  if (bf > 18) leanFrac -= 0.05;
  if (bf < 12) leanFrac += 0.05;
  leanFrac = clamp(leanFrac, BODY_COMP.BULK_LEAN_FRAC.min, BODY_COMP.BULK_LEAN_FRAC.max);

  return {
    fatChange: weightChangeKg * (1 - leanFrac),
    leanChange: weightChangeKg * leanFrac,
    waterChange: 0,
    leanFraction: leanFrac,
    note: 'Partition is approximate — not measured muscle gain',
  };
}

export function portionGuide(macros) {
  return {
    protein: { min: Math.max(3, Math.round(macros.protein / 30) - 1), max: Math.round(macros.protein / 30) + 1 },
    carbs: { min: Math.max(4, Math.round(macros.carbs / 40) - 1), max: Math.round(macros.carbs / 40) + 2 },
    fat: { min: Math.max(2, Math.round(macros.fat / 15) - 1), max: Math.round(macros.fat / 15) + 1 },
  };
}

export function validateProfile(data) {
  const errors = [];
  if (!data.age || data.age < 16 || data.age > 80) errors.push('Age must be between 16 and 80');
  if (!data.heightCm || data.heightCm < 120 || data.heightCm > 230) errors.push('Invalid height');
  if (!data.weightKg || data.weightKg < 35 || data.weightKg > 250) errors.push('Invalid weight');
  if (!data.bodyFatPercent || data.bodyFatPercent < 3 || data.bodyFatPercent > 50) errors.push('Body fat must be 3–50%');
  if (!['male', 'female'].includes(data.sex)) errors.push('Select sex');
  if (!ACTIVITY_MULTIPLIERS[data.activityLevel]) errors.push('Select activity level');
  return errors;
}

export function buildInitialPlan(profile, settings) {
  const tdeeResult = calculateInitialTDEE(profile);
  const tdee = tdeeResult.estimate;
  const { fatMass, leanMass } = compositionFromBF(profile.weightKg, profile.bodyFatPercent);
  const ffmi = calculateFFMI(leanMass, profile.heightCm);
  const gainRange = recommendedGainRange(profile, PHASE.BULK, profile.weightKg);
  const maxBf = maxBulkBodyFat(profile.bodyFatPercent, settings.bulkWeeks, gainRange, BODY_COMP.BULK_LEAN_FRAC.mid);
  const bulkCalories = initialCalorieTarget(tdee, PHASE.BULK);
  const minicutCalories = initialCalorieTarget(tdee, PHASE.MINICUT);
  const macros = calculateMacros(bulkCalories, profile.weightKg);
  const water = calculateWaterTarget(profile.weightKg, profile.trainingSessions, profile.activityLevel);

  return {
    bmr: round(calculateBMR(profile), 0),
    tdee,
    tdeeRange: { low: tdeeResult.low, high: tdeeResult.high },
    bulkCalories: round(bulkCalories, 0),
    minicutCalories: round(minicutCalories, 0),
    macros,
    water: water.ml,
    leanMass: round(leanMass, 1),
    fatMass: round(fatMass, 1),
    ffmi: round(ffmi, 1),
    gainRange,
    maxBf: maxBf.point,
    maxBfRange: maxBf,
  };
}

// Legacy aliases
export const calculateLeanFatMass = compositionFromBF;
