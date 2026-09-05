/**
 * Masscience v2.4 — Improved Causal Closed-Loop Simulation
 * 
 * Key improvements:
 * 1. Separate tissue weight from transients (glycogen + water)
 * 2. Kalman-style state estimation for TDEE, fat mass, tissue weight
 * 3. Phase-aware controller with explicit transition handling
 * 4. PI controller with rate limiting + anti-windup
 * 5. Confidence-weighted gains
 * 6. Physiological ceilings and safeguards
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { processWeightData, estimateMissingWeights } from '../trend.js';
import { recommendedGainRange, calculateInitialTDEE, initialCalorieTarget } from '../calculations.js';
import { PHASE, CALORIES } from '../constants.js';
import { updateTissueWeight, updateBodyFatEstimate, updateTDEEEstimate, computeStateConfidence } from '../v24-state-estimator.js';
import { controllerCalorieAdjustment, checkSafetyLimits, detectControllerOscillation } from '../v24-controller.js';
import { PhaseTransitionTracker, shouldTransitionPhase, getPhaseTransitionCalorieShift, scheduleCalorieRamp, adjustTargetRateForTransition, shouldSuppressControllerDuringTransition } from '../v24-phase-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED = 20260830;

// Copy PRNG functions from original
function createSeededPRNG(seed = SEED) {
  let s = seed >>> 0;
  return function prng() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createNormalPRNG(prng) {
  return function nextNormal(mean = 0, stdDev = 1) {
    let u1 = prng();
    let u2 = prng();
    while (u1 <= 1e-10) u1 = prng();
    while (u2 <= 1e-10) u2 = prng();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    return mean + z0 * stdDev;
  };
}

function addDays(dateString, days) {
  const date = new Date(dateString);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function pearsonCorrelation(x, y) {
  const n = x.length;
  if (n === 0) return 0;
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  if (denX === 0 || denY === 0) return 1.0;
  return num / Math.sqrt(denX * denY);
}

const KCAL_PER_KG_FAT = 9400;
const KCAL_PER_KG_MUSCLE = 1800;
const KCAL_PER_KG_OTHER_LEAN = 1200;
const KCAL_PER_KG_GLYCOGEN = 4100;

function clamp(v, lo, hi) { return Math.min(Math.max(v, lo), hi); }

// =========================================================
// GROUND TRUTH PHYSIOLOGICAL ENGINE (unchanged from v2.3)
// =========================================================

function computeFatAvailabilityFraction(trueBfPercent) {
  const bfLow = 5.0;
  const bfRef = 14.0;
  const bfHigh = 25.0;
  if (trueBfPercent <= bfLow) {
    const t = clamp(trueBfPercent / Math.max(bfLow, 0.1), 0, 1);
    return 0.38 + 0.10 * t;
  }
  if (trueBfPercent <= bfRef) {
    const t = (trueBfPercent - bfLow) / (bfRef - bfLow);
    return 0.58 + 0.22 * t;
  }
  if (trueBfPercent <= bfHigh) {
    const t = (trueBfPercent - bfRef) / (bfHigh - bfRef);
    return 0.80 + 0.10 * t;
  }
  return 0.93;
}

function muscleGainTrainingAgeMultiplier(trainingYears) {
  return Math.exp(-0.28 * trainingYears) * 0.82 + 0.18;
}

function muscleGainAgeMultiplier(age) {
  if (age <= 25) return 1.00;
  return clamp(1.00 - 0.012 * (age - 25), 0.55, 1.00);
}

function muscleGainBfSurplusMultiplier(trueBfPercent) {
  const bfOpt = 10.0;
  const dist = Math.abs(trueBfPercent - bfOpt);
  if (dist < 4) return 1.00;
  return clamp(1.00 - 0.02 * (dist - 4), 0.65, 1.05);
}

function energyAvailabilityForMuscle(surplusKcalPerKgBw, phase) {
  if (surplusKcalPerKgBw >= 0) {
    const x = surplusKcalPerKgBw;
    return clamp(0.15 + (1 - Math.exp(-x / 8.0)) * 0.90, 0.15, 1.15);
  }
  const x = -surplusKcalPerKgBw;
  return clamp(Math.exp(-x / 4.0) * 0.15, 0.0, 0.15);
}

function proteinAdequacyMultiplier(proteinGPerKg) {
  if (proteinGPerKg < 1.2) return 0.55 + (proteinGPerKg / 1.2) * 0.20;
  if (proteinGPerKg <= 2.0) return 0.80 + ((proteinGPerKg - 1.2) / 0.8) * 0.20;
  return 1.00 + Math.min(0.05, (proteinGPerKg - 2.0) * 0.025);
}

function trainingStimulusMultiplier(trainingSessionsPerWeek) {
  if (trainingSessionsPerWeek <= 0) return 0.10;
  if (trainingSessionsPerWeek <= 2) return 0.30 + trainingSessionsPerWeek * 0.15;
  if (trainingSessionsPerWeek === 3) return 0.85;
  if (trainingSessionsPerWeek === 4) return 1.00;
  if (trainingSessionsPerWeek === 5) return 1.05;
  return 1.08;
}

function computeDailyMuscleAnabolismCeiling(profile) {
  const noviceCeilingKgPerDay = 0.0285;
  const ta = muscleGainTrainingAgeMultiplier(profile.trainingYears);
  const ageM = muscleGainAgeMultiplier(profile.age);
  return noviceCeilingKgPerDay * ta * ageM;
}

// =========================================================
// V2.4 MAIN SIMULATION
// =========================================================

export function run180DaySimulationV24(seed = SEED, options = {}) {
  const prng = createSeededPRNG(seed);
  const nextNormal = createNormalPRNG(prng);

  const profile = options.profile || {
    age: 29,
    sex: 'male',
    heightCm: 178,
    weightKg: 70,
    bodyFatPercent: 8,
    trainingYears: 4,
    trainingSessions: 4,
    activityLevel: 'moderately_active',
  };

  const startDate = '2026-01-01';
  const totalDays = 180;

  const schedule = options.schedule || [
    { name: PHASE.BULK, days: 70, id: 'bulk_1' },
    { name: PHASE.MINICUT, days: 28, id: 'minicut' },
    { name: PHASE.BULK, days: 82, id: 'bulk_2' },
  ];

  // ---- GROUND TRUTH INITIALIZATION ----
  const initialWeight = profile.weightKg;
  const initialFatMass = initialWeight * (profile.bodyFatPercent / 100);
  const initialTotalLeanMass = initialWeight - initialFatMass;

  let fatMass = initialFatMass;
  const initialMuscleTissueMass = initialTotalLeanMass * 0.45;
  let muscleTissueMass = initialMuscleTissueMass;
  const initialOtherLeanTissueMass = initialTotalLeanMass * 0.25;
  let otherLeanTissueMass = initialOtherLeanTissueMass;
  const initialGlycogenMass = 0.50;
  let glycogenMass = initialGlycogenMass;
  const initialDigestiveContentMass = 0.60;
  let digestiveContentMass = initialDigestiveContentMass;
  const initialBodyWaterMass = initialTotalLeanMass - muscleTissueMass - otherLeanTissueMass
    - glycogenMass - digestiveContentMass;
  let bodyWaterMass = initialBodyWaterMass;

  let truePhysiologicalWeight =
    fatMass + muscleTissueMass + otherLeanTissueMass + glycogenMass
    + bodyWaterMass + digestiveContentMass;
  const initialTruePhysiologicalWeight = truePhysiologicalWeight;

  // ---- CONTROLLER STATE (V2.4 NEW) ----
  const tdeeInit = calculateInitialTDEE(profile).estimate;
  let estimatedTissueWeight = initialWeight - (initialGlycogenMass + initialDigestiveContentMass + initialBodyWaterMass * 0.2);
  let estimatedBfPercent = profile.bodyFatPercent;
  let estimatedTDEE = tdeeInit;
  let tissueTrendHistory = [estimatedTissueWeight];
  let prevTrendWeight = initialWeight;  // Track previous trend weight for delta calculation
  let controllerState = { errorIntegral: 0, lastAdjustment: 0 };
  let adjustmentHistory = [];
  let phaseTransitionTracker = null;
  let calorieAdjustmentHistory = [];
  let lastCalorieAdjustmentDay = -999;
  
  // Initial calories - same as v2.3
  let currentCalories = initialCalorieTarget(tdeeInit, PHASE.BULK);
  
  // ---- OTHER STATE ----
  let adaptiveTDEE_gt = 0;
  let trainingReadiness = 1.0;
  let waterNoise = 0;
  let glycogenNoise = 0;
  let digestiveNoise = 0;

  const tdeeBaseVariance = options.tdeeBaseVariance ?? nextNormal(0, 60);
  const ind_muscleGainFactor = options.independentMuscleGain ?? clamp(1 + nextNormal(0, 0.12), 0.75, 1.30);
  const ind_fatMobilBias = options.independentFatMob ?? clamp(1 + nextNormal(0, 0.08), 0.80, 1.20);
  const tefFactor = clamp(0.09 + nextNormal(0, 0.01), 0.07, 0.12);

  const userWeighIns = [];
  const dailyGroundTruth = [];
  const weeklySnapshots = [];

  let oscillationCount = 0;

  for (let day = 0; day < totalDays; day++) {
    const currentDate = addDays(startDate, day);

    // ---- PHASE MANAGEMENT ----
    let currentPhaseIndex = 0;
    for (let i = 0; i < schedule.length; i++) {
      const phaseDays = schedule.slice(0, i + 1).reduce((sum, p) => sum + p.days, 0);
      if (day < phaseDays) {
        currentPhaseIndex = i;
        break;
      }
    }
    const currentPhaseItem = schedule[currentPhaseIndex];
    const currentPhase = currentPhaseItem.name;
    const daysInCurrentPhase = day - (currentPhaseIndex > 0 ? schedule.slice(0, currentPhaseIndex).reduce((s, p) => s + p.days, 0) : 0);

    // ---- HANDLE PHASE TRANSITIONS ----
    if (currentPhaseIndex > 0 && daysInCurrentPhase === 0) {
      // Just transitioned
      const prevPhase = schedule[currentPhaseIndex - 1].name;
      phaseTransitionTracker = new PhaseTransitionTracker(prevPhase, currentPhase, day);
      
      // Schedule ramped calorie shift
      const shiftAmount = getPhaseTransitionCalorieShift(prevPhase, currentPhase, estimatedTDEE, profile);
      const ramp = scheduleCalorieRamp(shiftAmount, 4);
      calorieAdjustmentHistory.push({ date: currentDate, adjustment: 0, reason: 'phase_transition', ramp });
    }

    // Update phase transition tracker
    if (phaseTransitionTracker) {
      phaseTransitionTracker.update(day);
    }

    // ---- GROUND TRUTH: TDEE CALCULATION ----
    const bmrToday = 10 * truePhysiologicalWeight + 6.25 * profile.heightCm
      - 5 * profile.age + (profile.sex === 'male' ? 5 : -161);
    const dailyActivityJitter = nextNormal(0, 0.02);
    const activityKcal = bmrToday * (0.55 + dailyActivityJitter);
    const tefKcal = currentCalories * tefFactor;
    const initialLean = (initialTruePhysiologicalWeight - initialFatMass);
    const currentLean = muscleTissueMass + otherLeanTissueMass + glycogenMass + bodyWaterMass * 0.0;
    const leanMassCost = (currentLean - initialLean * 0.70) * 11.0;
    const surplusToday = currentCalories - (bmrToday + activityKcal + tefKcal + leanMassCost + adaptiveTDEE_gt);
    const targetAdaptive = currentPhase === PHASE.MINICUT
      ? clamp(-60 - Math.min(60, Math.abs(surplusToday) * 0.02), -160, 0)
      : clamp(30 + Math.min(40, surplusToday * 0.01), 0, 90);
    adaptiveTDEE_gt += (targetAdaptive - adaptiveTDEE_gt) * 0.045;

    const trueTDEE = Number(
      (bmrToday + activityKcal + tefKcal + leanMassCost + adaptiveTDEE_gt + tdeeBaseVariance).toFixed(1)
    );
    const trueEnergyIntakeKcal = currentCalories;
    const ebKcal = trueEnergyIntakeKcal - trueTDEE;

    // ---- GROUND TRUTH: ENERGY PARTITIONING (unchanged from v2.3) ----
    let deltaFat = 0, deltaMuscle = 0, deltaOtherLean = 0;
    let deltaGlycogen = 0;
    const bwKg = truePhysiologicalWeight;
    const surplusPerKg = ebKcal / Math.max(bwKg, 40);

    const baseGlycogenKg = profile.sex === 'male' ? 0.48 : 0.40;
    let targetGlycogen = baseGlycogenKg;
    if (ebKcal >= 0) targetGlycogen += clamp(ebKcal / 2500, 0, 0.22);
    else targetGlycogen -= clamp(-ebKcal / 2000, 0, 0.28);

    const phaseBlend = clamp(daysInCurrentPhase / 7, 0, 1);
    if (daysInCurrentPhase < 7) {
      const oldPhaseGlycEffect = currentPhaseIndex > 0 && schedule[currentPhaseIndex - 1].name === PHASE.BULK ? 0.04 : -0.08;
      targetGlycogen = baseGlycogenKg
        + (ebKcal >= 0 ? clamp(ebKcal / 2500, 0, 0.22) : -clamp(-ebKcal / 2000, 0, 0.28))
        + oldPhaseGlycEffect * (1 - phaseBlend)
        + (currentPhase === PHASE.BULK ? 0.04 : -0.08) * phaseBlend;
    } else {
      targetGlycogen += (currentPhase === PHASE.BULK ? 0.04 : -0.08);
    }

    const isTrainingDay = (day % 7) === 0 || (day % 7) === 2 || (day % 7) === 4 || (day % 7) === 6;
    if (profile.trainingSessions >= 4) {
      targetGlycogen += isTrainingDay ? -0.02 + nextNormal(0, 0.005) : 0.015;
    }
    targetGlycogen = clamp(targetGlycogen, 0.18, 0.85);

    const glycogenAlpha = daysInCurrentPhase < 5 ? 0.22 + (daysInCurrentPhase / 5) * 0.18 : 0.40;
    const glycChange = (targetGlycogen - glycogenMass) * glycogenAlpha + nextNormal(0, 0.008);
    deltaGlycogen = glycChange;
    const energyToGlycogen = deltaGlycogen * KCAL_PER_KG_GLYCOGEN;
    let ebRemainingKcal = ebKcal - energyToGlycogen;

    const trueBfNow = (fatMass / Math.max(truePhysiologicalWeight, 1)) * 100;

    if (ebRemainingKcal >= 0) {
      const ea = energyAvailabilityForMuscle(surplusPerKg, currentPhase);
      const protM = proteinAdequacyMultiplier(2.0);
      const trainM = trainingStimulusMultiplier(profile.trainingSessions);
      const bfM = muscleGainBfSurplusMultiplier(trueBfNow);
      const ceilingKgDay = computeDailyMuscleAnabolismCeiling(profile);
      const maxMuscleKgToday = ceilingKgDay * ea * protM * trainM * bfM * ind_muscleGainFactor * trainingReadiness;
      const kcalMaxToMuscle = maxMuscleKgToday * KCAL_PER_KG_MUSCLE;
      const leanPartFrac = clamp(kcalMaxToMuscle / Math.max(ebRemainingKcal, 1), 0.05, 0.55);
      let kcalToMuscle = Math.min(kcalMaxToMuscle, ebRemainingKcal * leanPartFrac);
      let kcalToOtherLean = kcalToMuscle * 0.08;
      if (kcalToMuscle + kcalToOtherLean > ebRemainingKcal) {
        kcalToOtherLean = (ebRemainingKcal - kcalToMuscle) * 0.08;
        kcalToOtherLean = Math.max(0, kcalToOtherLean);
      }
      let kcalToFat = ebRemainingKcal - kcalToMuscle - kcalToOtherLean;
      kcalToFat = Math.max(0, kcalToFat);

      deltaMuscle = kcalToMuscle / KCAL_PER_KG_MUSCLE;
      deltaOtherLean = kcalToOtherLean / KCAL_PER_KG_OTHER_LEAN;
      deltaFat = kcalToFat / KCAL_PER_KG_FAT;
    } else {
      const deficitKcal = -ebRemainingKcal;
      const fatAvail = computeFatAvailabilityFraction(trueBfNow) * ind_fatMobilBias;
      const maxFatKgPerDay = clamp(0.013 + fatMass * 0.0070, 0.020, 0.100);
      const kcalMaxFromFat = maxFatKgPerDay * KCAL_PER_KG_FAT;
      const fatMobilFrac = clamp(fatAvail, 0.30, 0.95);
      let kcalFromFat = deficitKcal * fatMobilFrac;
      kcalFromFat = Math.min(kcalFromFat, kcalMaxFromFat);
      const kcalRemaining = deficitKcal - kcalFromFat;

      const trainedSparing = 0.62 + 0.12 * trainingStimulusMultiplier(profile.trainingSessions);
      const proteinSparing = clamp(0.05 * (2.0 - 1.2), 0, 0.10);
      const fracMuscleFromLean = clamp(0.48 - trainedSparing * 0.22 - proteinSparing, 0.18, 0.48);
      let kcalFromMuscle = kcalRemaining * fracMuscleFromLean;
      let kcalFromOtherLean = kcalRemaining - kcalFromMuscle;

      deltaFat = -kcalFromFat / KCAL_PER_KG_FAT;
      deltaMuscle = -kcalFromMuscle / KCAL_PER_KG_MUSCLE;
      deltaOtherLean = -kcalFromOtherLean / KCAL_PER_KG_OTHER_LEAN;
    }

    fatMass = Math.max(1.2, fatMass + deltaFat);
    muscleTissueMass = Math.max(10.0, muscleTissueMass + deltaMuscle);
    otherLeanTissueMass = Math.max(10.0, otherLeanTissueMass + deltaOtherLean);
    glycogenMass = clamp(glycogenMass + deltaGlycogen, 0.15, 0.90);

    const deltaGlycogenWater = (glycogenMass - initialGlycogenMass) * 3.0;
    const smallLeanHydration = (
      (muscleTissueMass - initialMuscleTissueMass) * 0.18 +
      (otherLeanTissueMass - initialOtherLeanTissueMass) * 0.12
    );
    const waterPhaseEffect = currentPhase === PHASE.BULK
      ? 0.04 + clamp(ebKcal / 4200, 0, 0.09)
      : -0.10 + clamp(ebKcal / 3200, -0.10, 0);
    const switchMagnitude = currentPhaseIndex > 0
      ? (schedule[currentPhaseIndex - 1].name === PHASE.MINICUT ? 0.22 : -0.18)
      : 0;
    const justSwitchedWater = daysInCurrentPhase < 7
      ? switchMagnitude * Math.exp(-daysInCurrentPhase / 2.2)
      : 0;
    const waterTarget = initialBodyWaterMass + deltaGlycogenWater + smallLeanHydration + waterPhaseEffect + justSwitchedWater;
    const waterAlpha = daysInCurrentPhase < 4 ? 0.05 + daysInCurrentPhase * 0.018 : 0.07;
    bodyWaterMass += (waterTarget - bodyWaterMass) * waterAlpha + nextNormal(0, 0.010);
    bodyWaterMass = clamp(bodyWaterMass, initialBodyWaterMass * 0.82, initialBodyWaterMass * 1.20);

    const kcalVolumeFactor = trueEnergyIntakeKcal / 2500;
    const digestiveTarget = 0.55 * kcalVolumeFactor + (currentPhase === PHASE.BULK ? 0.05 : -0.04);
    const digestiveAlpha = daysInCurrentPhase < 3 ? 0.14 + (daysInCurrentPhase / 3) * 0.14 : 0.28;
    digestiveContentMass += (digestiveTarget - digestiveContentMass) * digestiveAlpha + nextNormal(0, 0.010);
    digestiveContentMass = clamp(digestiveContentMass, 0.25, 1.20);

    const prevTPW = truePhysiologicalWeight;
    truePhysiologicalWeight =
      fatMass + muscleTissueMass + otherLeanTissueMass + glycogenMass + bodyWaterMass + digestiveContentMass;

    const rawDelta = truePhysiologicalWeight - prevTPW;
    const MAX_DAILY_CHANGE_KG = 0.16;
    if (Math.abs(rawDelta) > MAX_DAILY_CHANGE_KG) {
      const excess = rawDelta - Math.sign(rawDelta) * MAX_DAILY_CHANGE_KG;
      const fastCompSum = glycogenMass + bodyWaterMass + digestiveContentMass;
      if (fastCompSum > 0.1) {
        const glycShare = glycogenMass / fastCompSum;
        const waterShare = bodyWaterMass / fastCompSum;
        const digShare = digestiveContentMass / fastCompSum;
        glycogenMass = Math.max(0.15, glycogenMass - glycShare * excess * 0.85);
        bodyWaterMass = Math.max(initialBodyWaterMass * 0.82, bodyWaterMass - waterShare * excess * 0.85);
        digestiveContentMass = Math.max(0.25, digestiveContentMass - digShare * excess * 0.85);
        truePhysiologicalWeight = fatMass + muscleTissueMass + otherLeanTissueMass + glycogenMass + bodyWaterMass + digestiveContentMass;
      }
    }

    const trueBodyFat = (fatMass / Math.max(truePhysiologicalWeight, 1)) * 100;

    if (isTrainingDay) trainingReadiness = clamp(trainingReadiness - 0.06 + nextNormal(0, 0.01), 0.65, 1.0);
    else trainingReadiness = clamp(trainingReadiness + 0.02 + nextNormal(0, 0.005), 0.70, 1.05);

    waterNoise = 0.72 * waterNoise + nextNormal(0, 0.09);
    glycogenNoise = 0.60 * glycogenNoise + nextNormal(0, 0.055);
    digestiveNoise = 0.48 * digestiveNoise + nextNormal(0, 0.045);
    const scaleNoise = nextNormal(0, 0.045);
    const totalObservationNoise = waterNoise + glycogenNoise + digestiveNoise + scaleNoise;
    const observedWeight = Number((truePhysiologicalWeight + totalObservationNoise).toFixed(2));

    // ---- STORE DAILY GROUND TRUTH ----
    const tfm = Number(fatMass.toFixed(2));
    const tmm = Number(muscleTissueMass.toFixed(2));
    const tolm = Number(otherLeanTissueMass.toFixed(2));
    const tgm = Number(glycogenMass.toFixed(2));
    const tbwm = Number(bodyWaterMass.toFixed(2));
    const tdcm = Number(digestiveContentMass.toFixed(2));
    const tpw = Number((tfm + tmm + tolm + tgm + tbwm + tdcm).toFixed(2));

    dailyGroundTruth.push({
      day,
      date: currentDate,
      truePhysiologicalWeight: tpw,
      trueBodyFat,
      trueFatMass: tfm,
      trueMuscleTissueMass: tmm,
      trueOtherLeanTissueMass: tolm,
      trueGlycogenMass: tgm,
      trueBodyWaterMass: tbwm,
      trueDigestiveContentMass: tdcm,
      observedWeight,
      phase: currentPhase,
      phaseId: currentPhaseItem.id,
      trueEnergyIntakeKcal,
      trueTDEE,
      energyBalance: ebKcal,
    });

    // ---- SPARSE WEIGH-INS ----
    const dow = day % 7;
    if (dow === 0 || dow === 2 || dow === 5) {
      userWeighIns.push({ date: currentDate, weight: observedWeight, isEstimated: false });
    }

    // ---- WEEKLY CONTROLLER UPDATE ----
    if (dow === 6 || day === totalDays - 1) {
      const weekNum = Math.floor(day / 7) + 1;
      const historyToDate = userWeighIns.filter(m => m.date <= currentDate);
      const withEstimates = estimateMissingWeights(historyToDate, startDate, currentDate);
      const trendData = processWeightData(withEstimates, startDate);
      const trendWt = Number((trendData.latest?.trend ?? observedWeight).toFixed(2));
      const gainRange = recommendedGainRange(profile, currentPhase, trendWt);
      
      // ---- V2.4: STATE ESTIMATION ----
      const trendWeightDelta = trendWt - prevTrendWeight; // Use trend weight change directly
      
      const newTissueWeight = updateTissueWeight(
        estimatedTissueWeight,
        trendWt,
        ebKcal / 7, // Average daily EB for the week
        daysInCurrentPhase,
        currentPhase,
        trendData.confidence ?? 50
      );
      
      const oldBfEstimate = estimatedBfPercent;
      // NOW: pass prevTrendWeight for better BF delta calculation
      estimatedBfPercent = updateBodyFatEstimate(
        oldBfEstimate,
        newTissueWeight,
        estimatedTissueWeight,
        trendWt,
        prevTrendWeight,  // NEW: pass previous trend weight
        currentPhase,
        profile.trainingYears,
        trendData.confidence ?? 50
      );
      
      // NOW: use trend weight delta (less filtered) instead of tissue delta
      const tdeeUpdate = updateTDEEEstimate(
        estimatedTDEE,
        currentCalories,
        trendWeightDelta / 7, // Per day, from trend (not filtered tissue)
        7, // Days since last update
        trendData.confidence ?? 50,
        currentPhase  // NEW: pass phase for better TDEE handling
      );
      
      estimatedTissueWeight = newTissueWeight;
      estimatedTDEE = tdeeUpdate;
      prevTrendWeight = trendWt;  // Update for next week's calculation
      tissueTrendHistory.push(newTissueWeight);
      
      const tissueRate = (newTissueWeight - (tissueTrendHistory[Math.max(0, tissueTrendHistory.length - 8)] ?? tissueTrendHistory[0])) / 7 * 7; // Weekly
      const targetRate = adjustTargetRateForTransition(gainRange.target, phaseTransitionTracker, currentPhase);
      
      const stateConfidence = computeStateConfidence(trendData, tissueTrendHistory);

      // ---- V2.4: IMPROVED CONTROLLER ----
      let shouldMakeAdjustment = true;
      let suppressReason = null;
      
      if (phaseTransitionTracker && !phaseTransitionTracker.isSettled) {
        const suppressCheck = shouldSuppressControllerDuringTransition(phaseTransitionTracker, trendData, tissueRate - targetRate);
        if (suppressCheck.shouldSuppress) {
          shouldMakeAdjustment = false;
          suppressReason = suppressCheck.reason;
        }
      }
      
      let decision = { shouldAdjust: false, adjustment: 0, recommendedCalories: currentCalories, status: 'NEUTRAL' };
      
      if (shouldMakeAdjustment) {
        decision = controllerCalorieAdjustment(
          currentCalories,
          tissueRate,
          targetRate,
          stateConfidence,
          currentPhase,
          day - lastCalorieAdjustmentDay,
          controllerState
        );
        
        if (decision.shouldAdjust) {
          currentCalories = decision.recommendedCalories;
          lastCalorieAdjustmentDay = day;
          calorieAdjustmentHistory.push({
            date: currentDate,
            adjustment: decision.adjustment,
            from: currentCalories - decision.adjustment,
            to: currentCalories,
            reason: 'controller_adjustment',
          });
          adjustmentHistory.push(decision.adjustment);
          
          // Update controller state
          if (decision.controllerStateUpdate) {
            controllerState = decision.controllerStateUpdate;
          }
        }
      }
      
      // Check for oscillation
      if (adjustmentHistory.length >= 3) {
        const recent = adjustmentHistory.slice(-3);
        if (Math.sign(recent[0]) !== Math.sign(recent[2]) && recent[1] * recent[0] < 0) {
          oscillationCount++;
        }
      }

      // ---- WEEKLY SNAPSHOT ----
      weeklySnapshots.push({
        week: weekNum,
        phase: currentPhase,
        phaseId: currentPhaseItem.id,
        startDate: addDays(startDate, (weekNum - 1) * 7),
        endDate: currentDate,
        observedWeightKg: observedWeight,
        trendWeightKg: trendWt,
        ratePerWeek: tissueRate,
        targetRatePerWeek: Number(targetRate.toFixed(3)),
        confidence: stateConfidence,
        recommendedCalories: decision.recommendedCalories,
        appliedIntakeCalories: currentCalories,
        estimatedTDEE,
        estimatedBfPercent,
        adjustment: decision.adjustment,
        status: decision.status,
        suppressedReason: suppressReason,
        groundTruth: {
          truePhysiologicalWeightKg: tpw,
          trueBodyFatPercent: Number(trueBodyFat.toFixed(1)),
          trueFatMassKg: tfm,
          trueMuscleMassKg: tmm,
          trueOtherLeanKg: tolm,
          trueGlycogenKg: tgm,
          trueWaterKg: tbwm,
          trueDigestiveKg: tdcm,
          trueTDEEKcal: trueTDEE,
        },
      });
    }
  }

  // ================== SUMMARY (compute all metrics) ==================
  const finalGt = dailyGroundTruth[dailyGroundTruth.length - 1];
  const initTPW = Number(initialTruePhysiologicalWeight.toFixed(2));
  const finalTPW = finalGt.truePhysiologicalWeight;
  const initTFM = Number(initialFatMass.toFixed(2));
  const finalTFM = finalGt.trueFatMass;
  const initTMM = Number((initialTotalLeanMass * 0.45).toFixed(2));
  const finalTMM = finalGt.trueMuscleTissueMass;
  const initTBF = profile.bodyFatPercent;
  const finalTBF = finalGt.trueBodyFat;

  const trueFatMassChange = Number((finalTFM - initTFM).toFixed(2));
  const trueMuscleMassChange = Number((finalTMM - initTMM).toFixed(2));
  const trueBodyFatChange = Number((finalTBF - initTBF).toFixed(2));

  // Trend metrics
  const initialTrendWeightKg = weeklySnapshots[0].trendWeightKg;
  const finalSnapshot = weeklySnapshots[weeklySnapshots.length - 1];
  const finalTrendWeightKg = finalSnapshot.trendWeightKg;
  const observedNetChangeKg = Number((finalTrendWeightKg - initialTrendWeightKg).toFixed(2));
  const totalWeeks = Number((totalDays / 7).toFixed(2));
  const averageTrendRatePerWeek = Number((observedNetChangeKg / totalWeeks).toFixed(3));

  // Validation metrics
  const trendErrors = weeklySnapshots.map(s => s.trendWeightKg - s.groundTruth.truePhysiologicalWeightKg);
  const trendWeightMAE = Number((trendErrors.reduce((a, e) => a + Math.abs(e), 0) / trendErrors.length).toFixed(3));
  const trendWeightRMSE = Number((Math.sqrt(trendErrors.reduce((a, e) => a + e * e, 0) / trendErrors.length)).toFixed(3));
  const trendWeightBias = Number((trendErrors.reduce((a, e) => a + e, 0) / trendErrors.length).toFixed(3));
  const trendWeightCorrelation = Number(pearsonCorrelation(
    weeklySnapshots.map(s => s.trendWeightKg),
    weeklySnapshots.map(s => s.groundTruth.truePhysiologicalWeightKg)
  ).toFixed(4));

  const tdeeErrors = weeklySnapshots.map(s => s.estimatedTDEE - s.groundTruth.trueTDEEKcal);
  const tdeeMAE = Number((tdeeErrors.reduce((a, e) => a + Math.abs(e), 0) / tdeeErrors.length).toFixed(3));
  const tdeeBias = Number((tdeeErrors.reduce((a, e) => a + e, 0) / tdeeErrors.length).toFixed(3));

  const bfErrors = weeklySnapshots.map(s => s.estimatedBfPercent - s.groundTruth.trueBodyFatPercent);
  const bodyFatMAE = Number((bfErrors.reduce((a, e) => a + Math.abs(e), 0) / bfErrors.length).toFixed(3));
  const bodyFatBias = Number((bfErrors.reduce((a, e) => a + e, 0) / bfErrors.length).toFixed(3));

  const rateErrors = weeklySnapshots.map(s => s.ratePerWeek - s.targetRatePerWeek);
  const integralAbsoluteRateError = Number(rateErrors.reduce((a, e) => a + Math.abs(e), 0).toFixed(3));
  const steadyStateRateError = Number(Math.abs(rateErrors[rateErrors.length - 1]).toFixed(3));
  const totalCalorieAdjustments = calorieAdjustmentHistory.filter(c => c.reason === 'controller_adjustment').length;
  const adjustmentsVal = adjustmentHistory.map(c => Math.abs(c));
  const calorieAdjustmentVariance = adjustmentsVal.length
    ? Number((adjustmentsVal.reduce((a, b) => a + b, 0) / adjustmentsVal.length).toFixed(1))
    : 0;
  const maximumCalorieAdjustment = adjustmentsVal.length ? Math.max(...adjustmentsVal) : 0;

  const summary = {
    version: 'v2.4',
    scenario: 'Improved Closed-Loop Simulation with State Estimation',
    seed,
    totalDays,
    totalWeeks,
    groundTruth6ComponentBodyComposition: {
      initialTruePhysiologicalWeight: initTPW,
      finalTruePhysiologicalWeight: finalTPW,
      initialTrueFatMass: initTFM,
      finalTrueFatMass: finalTFM,
      initialTrueMuscleMass: initTMM,
      finalTrueMuscleMass: finalTMM,
      initialTrueBodyFat: initTBF,
      finalTrueBodyFat: finalTBF,
      trueFatMassChange,
      trueMuscleMassChange,
      trueBodyFatChange,
    },
    initialTrendWeightKg,
    finalTrendWeightKg,
    observedNetChangeKg,
    averageTrendRatePerWeek,
    validation: {
      trendWeightCorrelation,
      trendWeightMAE,
      trendWeightRMSE,
      trendWeightBias,
      tdeeMAE,
      tdeeBias,
      bodyFatMAE,
      bodyFatBias,
      integralAbsoluteRateError,
      steadyStateRateError,
      totalCalorieAdjustments,
      calorieAdjustmentVariance,
      maximumCalorieAdjustment,
      oscillationCount,
    },
  };

  return { summary, weeklySnapshots, dailyGroundTruth };
}
