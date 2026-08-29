/**
 * Masscience — Demo dataset generator
 */
import { createDefaultState, saveState } from './storage.js';
import { createCycle } from './cycle.js';
import { buildInitialPlan } from './calculations.js';
import { ALGORITHM_VERSION } from './constants.js';
import { formatDate, addDays } from './utils.js';

function generateDemoWeights(startDate, startWeight, days, ratePerWeek) {
  const measurements = [];
  const ratePerDay = ratePerWeek / 7;

  for (let d = 0; d < days; d++) {
    const date = addDays(startDate, d);
    const trend = startWeight + ratePerDay * d;
    const noise = (Math.sin(d * 0.7) * 0.3) + (Math.random() - 0.5) * 0.4;
    const weight = Math.round((trend + noise) * 100) / 100;

    const isEstimated = d >= 10 && d % 2 !== 0 && d < 24;
    if (isEstimated) continue;

    measurements.push({
      date,
      weight,
      isEstimated: false,
      isOutlier: d === 15 && false,
    });
  }

  return measurements;
}

export function loadDemoData() {
  const state = createDefaultState();
  const startDate = addDays(formatDate(new Date()), -45);

  state.onboarded = true;
  state.profile = {
    age: 28,
    sex: 'male',
    heightCm: 178,
    weightKg: 75,
    bodyFatPercent: 14,
    trainingYears: 3,
    trainingSessions: 4,
    activityLevel: 'moderately_active',
  };

  state.settings = {
    units: 'metric',
    theme: 'dark',
    bulkWeeks: 10,
    minicutWeeks: 3,
    notifications: true,
    showAlgorithmDetails: false,
    showPortionGuide: true,
  };

  const plan = buildInitialPlan(state.profile, state.settings);

  state.currentCycle = {
    id: 'demo-cycle-1',
    number: 1,
    startDate,
    phaseStartDate: startDate,
    phase: 'bulk',
    phaseWeeks: 10,
    calibrating: false,
    calibrationComplete: true,
    paused: false,
    initialTDEE: plan.tdee,
    initialWeight: 75,
    maxBf: plan.maxBf,
    algorithmVersion: ALGORITHM_VERSION,
  };

  state.weightMeasurements = generateDemoWeights(startDate, 75, 45, 0.18);

  state.bodyMeasurements = [
    { date: addDays(startDate, 14), waist: 82, neck: 38, chest: 102, arm: 36, thigh: 58 },
    { date: addDays(startDate, 35), waist: 83, neck: 38.5, chest: 103, arm: 36.5, thigh: 58.5 },
  ];

  state.calorieHistory = [
    { date: addDays(startDate, 20), previous: plan.bulkCalories, new: plan.bulkCalories - 100, adjustment: -100, reason: 'Gain rate slightly above target', status: 'yellow' },
    { date: addDays(startDate, 30), previous: plan.bulkCalories - 100, new: plan.bulkCalories - 100, adjustment: 0, reason: 'On track after adjustment', status: 'green' },
  ];

  state.algorithmState = {
    estimatedTDEE: plan.tdee + 60,
    tdeeConfidence: 78,
    currentCalories: plan.bulkCalories - 100,
    weighInFrequency: 'three_weekly',
    frequencyPhaseStart: addDays(startDate, 24),
    lastCalorieAdjustment: addDays(startDate, 20),
    consistencyScore: 82,
  };

  saveState(state);
  return state;
}

export function clearDemoAndReset() {
  localStorage.removeItem('masscience_data');
  return createDefaultState();
}
