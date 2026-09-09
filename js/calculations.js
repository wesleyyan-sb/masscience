/**
 * Masscience V2 — Metabolic & body composition calculations
 */
import {
  ACTIVITY_MULTIPLIERS, MACROS, WATER, BODY_COMP, GAIN_RATE, CYCLE, CALORIES, PHASE, MINICUT_CONFIG,
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
  const estBf = typeof bfEstimate === 'object' ? (bfEstimate.estimate ?? 15) : bfEstimate;
  const uncert = typeof bfEstimate === 'object' ? (bfEstimate.uncertainty || 2) : 2;
  const bfMin = typeof bfEstimate === 'object' ? (bfEstimate.low ?? (estBf - uncert)) : (estBf - uncert);
  const bfMax = typeof bfEstimate === 'object' ? (bfEstimate.high ?? (estBf + uncert)) : (estBf + uncert);

  const atMinBf = compositionFromBF(weightKg, bfMin);
  const atMidBf = compositionFromBF(weightKg, estBf);
  const atMaxBf = compositionFromBF(weightKg, bfMax);

  // 6-compartment latent estimates
  const estTotalLean = atMidBf.leanMass;
  const estMuscleMid = round(estTotalLean * 0.46, 1);
  const estMuscleLow = round(atMaxBf.leanMass * 0.45, 1);
  const estMuscleHigh = round(atMinBf.leanMass * 0.47, 1);

  const estStructuralMid = round(estTotalLean * 0.24, 1);
  const estGlycogenMid = 0.5;
  const estDigestiveMid = 0.6;
  const estWaterMid = round(estTotalLean - estMuscleMid - estStructuralMid - estGlycogenMid - estDigestiveMid, 1);

  return {
    fatMass: {
      low: round(Math.min(atMinBf.fatMass, atMaxBf.fatMass), 1),
      mid: round(atMidBf.fatMass, 1),
      high: round(Math.max(atMinBf.fatMass, atMaxBf.fatMass), 1),
      estimate: round(atMidBf.fatMass, 1),
    },
    leanMass: {
      low: round(Math.min(atMinBf.leanMass, atMaxBf.leanMass), 1),
      mid: round(atMidBf.leanMass, 1),
      high: round(Math.max(atMinBf.leanMass, atMaxBf.leanMass), 1),
      estimate: round(atMidBf.leanMass, 1),
    },
    contractileMuscle: {
      low: Math.min(estMuscleLow, estMuscleHigh),
      mid: estMuscleMid,
      high: Math.max(estMuscleLow, estMuscleHigh),
      estimate: estMuscleMid,
    },
    structuralLean: { mid: estStructuralMid, estimate: estStructuralMid },
    glycogen: { mid: estGlycogenMid, estimate: estGlycogenMid },
    hydrationWater: { mid: Math.max(10, estWaterMid), estimate: Math.max(10, estWaterMid) },
    digestive: { mid: estDigestiveMid, estimate: estDigestiveMid },
    note: 'Contractile muscle ≠ total lean mass. Hydration and glycogen vary with nutrition and training.',
  };
}

export function calculateFFMI(leanMassKg, heightCm) {
  const heightM = heightCm / 100;
  return leanMassKg / (heightM * heightM);
}

/** Jackson-Pollock 3-site caliper formula (laboratory-validated skinfolds) */
export function jacksonPollock3Skinfold(sex, age, folds = {}) {
  const userAge = Number(age) || 28;
  if (sex === 'female') {
    const { triceps, suprailiac, thigh } = folds;
    if (!triceps || !suprailiac || !thigh || triceps <= 0 || suprailiac <= 0 || thigh <= 0) return null;
    const sum = Number(triceps) + Number(suprailiac) + Number(thigh);
    const bd = 1.0994921 - (0.0009929 * sum) + (0.0000023 * sum * sum) - (0.0001392 * userAge);
    if (bd <= 0) return null;
    const bf = (495 / bd) - 450;
    return clamp(round(bf, 1), BODY_COMP.MIN_BF, BODY_COMP.MAX_BF);
  }
  // Male: chest, abdomen, thigh
  const { chest, abdomen, thigh } = folds;
  if (!chest || !abdomen || !thigh || chest <= 0 || abdomen <= 0 || thigh <= 0) return null;
  const sum = Number(chest) + Number(abdomen) + Number(thigh);
  const bd = 1.10938 - (0.0008267 * sum) + (0.0000016 * sum * sum) - (0.0002574 * userAge);
  if (bd <= 0) return null;
  const bf = (495 / bd) - 450;
  return clamp(round(bf, 1), BODY_COMP.MIN_BF, BODY_COMP.MAX_BF);
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
  const res = estimateBodyComposition(profile, trendData, bodyMeasurements, algorithmState);
  if (res._state && algorithmState && typeof algorithmState === 'object') {
    if (res._state.recentWeightDirection != null) {
      algorithmState.recentWeightDirection = res._state.recentWeightDirection;
    }
    if (res._state.bfTargetHistory != null) {
      algorithmState.bfTargetHistory = res._state.bfTargetHistory;
    }
    if (res._state.estimatedFatMassKg != null) {
      algorithmState.estimatedFatMassKg = res._state.estimatedFatMassKg;
    }
    if (res._state.prevTrendWeightForBf != null) {
      algorithmState.prevTrendWeightForBf = res._state.prevTrendWeightForBf;
    }
    if (res._state.bfLastEnergyDate != null) {
      algorithmState.bfLastEnergyDate = res._state.bfLastEnergyDate;
    }
  }
  return res.bf;
}

export function estimateBodyCompositionFull(profile, trendData, bodyMeasurements = [], algorithmState = {}) {
  const res = estimateBodyComposition(profile, trendData, bodyMeasurements, algorithmState);
  if (res._state && algorithmState && typeof algorithmState === 'object') {
    if (res._state.recentWeightDirection != null) {
      algorithmState.recentWeightDirection = res._state.recentWeightDirection;
    }
    if (res._state.bfTargetHistory != null) {
      algorithmState.bfTargetHistory = res._state.bfTargetHistory;
    }
    if (res._state.estimatedFatMassKg != null) {
      algorithmState.estimatedFatMassKg = res._state.estimatedFatMassKg;
    }
    if (res._state.prevTrendWeightForBf != null) {
      algorithmState.prevTrendWeightForBf = res._state.prevTrendWeightForBf;
    }
    if (res._state.bfLastEnergyDate != null) {
      algorithmState.bfLastEnergyDate = res._state.bfLastEnergyDate;
    }
  }
  return res;
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

/**
 * Calculates the minimum required calorie deficit to return to target BF
 * within the preferred 21-day horizon, capped at 650 kcal/day.
 */
export function planMinicutEnergyTarget(currentWeightKg, currentBfPercent, targetBfPercent, tdeeKcal, daysRemaining = 21) {
  let weight = currentWeightKg;
  let curBfRaw = currentBfPercent;
  let tgtBfRaw = targetBfPercent;
  let tdee = tdeeKcal;
  let days = daysRemaining;

  if (typeof currentWeightKg === 'object' && currentWeightKg !== null) {
    const opts = currentWeightKg;
    weight = opts.currentWeightKg ?? opts.trendWeightKg ?? opts.weightKg ?? 70;
    curBfRaw = opts.currentBfPercent ?? opts.currentEstimatedBf ?? opts.bodyFatPercent ?? 15;
    tgtBfRaw = opts.targetBfPercent ?? opts.targetBf ?? 10;
    tdee = opts.tdeeKcal ?? opts.estimatedTdee ?? opts.tdee ?? 2500;
    days = opts.daysRemaining ?? opts.preferredDays ?? 21;
  }

  const curBf = Math.max(3, curBfRaw);
  const tgtBf = Math.max(3, tgtBfRaw);
  const daysHorizon = Math.max(7, days);

  // If already at or below target + tolerance, use conservative minimum deficit
  if (curBf <= tgtBf + (MINICUT_CONFIG?.BF_TOLERANCE ?? 0.3)) {
    return {
      fatToLoseKg: 0,
      totalEnergyDeficitKcal: 0,
      requiredDeficit: MINICUT_CONFIG?.MIN_DEFICIT_KCAL ?? 300,
      appliedDeficit: MINICUT_CONFIG?.MIN_DEFICIT_KCAL ?? 300,
      targetCalories: Math.round(tdee - (MINICUT_CONFIG?.MIN_DEFICIT_KCAL ?? 300)),
      projectedDaysToTarget: MINICUT_CONFIG?.MIN_STABILIZATION_DAYS ?? 14,
      extensionLikely: false,
      extensionDays: 0,
    };
  }

  // Calculate required fat loss to return to target BF:
  // Current fat mass
  const currentFatKg = weight * (curBf / 100);
  const currentLeanKg = weight - currentFatKg;
  const targetFraction = tgtBf / 100;
  // Account for slight water/glycogen reduction in lean mass during cut
  const projectedLeanKg = currentLeanKg * 0.985;
  const projectedEndFatKg = (projectedLeanKg / (1 - targetFraction)) * targetFraction;
  const fatToLoseKg = Math.max(0.15, currentFatKg - projectedEndFatKg);

  // Stored chemical energy ~9400 kcal/kg lipid, fat energy share ~88%
  const totalEnergyDeficitKcal = (fatToLoseKg * 9400) / 0.88;

  // Deficit required to hit target in 'days' (default 21 days)
  const rawRequiredDeficit = Math.round(totalEnergyDeficitKcal / daysHorizon);
  const requiredDeficit = clamp(rawRequiredDeficit, MINICUT_CONFIG?.MIN_DEFICIT_KCAL ?? 300, 1500);

  // Absolute hard cap: NEVER exceed 650 kcal/day
  const maxDeficit = MINICUT_CONFIG?.MAX_DEFICIT_KCAL ?? 650;
  const appliedDeficit = clamp(requiredDeficit, MINICUT_CONFIG?.MIN_DEFICIT_KCAL ?? 300, maxDeficit);

  // Projected days at the applied deficit
  const projectedDaysToTarget = Math.max(
    MINICUT_CONFIG?.MIN_STABILIZATION_DAYS ?? 14,
    Math.round(totalEnergyDeficitKcal / appliedDeficit)
  );

  const preferredDays = MINICUT_CONFIG?.PREFERRED_DAYS ?? 21;
  const extensionLikely = projectedDaysToTarget > preferredDays;
  const extensionDays = Math.max(0, projectedDaysToTarget - preferredDays);

  return {
    fatToLoseKg: round(fatToLoseKg, 2),
    totalEnergyDeficitKcal: Math.round(totalEnergyDeficitKcal),
    requiredDeficit,
    appliedDeficit,
    targetCalories: Math.round(tdee - appliedDeficit),
    projectedDaysToTarget,
    extensionLikely,
    extensionDays,
  };
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
