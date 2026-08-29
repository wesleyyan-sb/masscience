/**
 * Masscience — localStorage persistence
 */
import { STORAGE_KEY, ALGORITHM_VERSION, APP_VERSION } from './constants.js';
import { today } from './utils.js';

export function createDefaultState() {
  return {
    version: APP_VERSION,
    algorithmVersion: ALGORITHM_VERSION,
    onboarded: false,
    profile: null,
    settings: {
      units: 'metric',
      theme: 'dark',
      bulkWeeks: 10,
      minicutWeeks: 3,
      notifications: true,
      showAlgorithmDetails: false,
      showPortionGuide: false,
    },
    currentCycle: null,
    weightMeasurements: [],
    bodyMeasurements: [],
    calorieHistory: [],
    cycleHistory: [],
    algorithmState: {
      estimatedTDEE: null,
      tdeeConfidence: 0,
      currentCalories: null,
      smoothedBf: null,
      weighInFrequency: 'daily',
      frequencyPhaseStart: null,
      lastCalorieAdjustment: null,
      consistencyScore: 0,
    },
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const data = JSON.parse(raw);
    return migrateState(data);
  } catch {
    return createDefaultState();
  }
}

export function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function migrateState(data) {
  const defaults = createDefaultState();
  return {
    ...defaults,
    ...data,
    settings: { ...defaults.settings, ...(data.settings || {}) },
    algorithmState: { ...defaults.algorithmState, ...(data.algorithmState || {}) },
  };
}

export function exportData(state) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `masscience-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function importData(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.version && !data.profile) {
          reject(new Error('Invalid Masscience backup file'));
          return;
        }
        resolve(migrateState(data));
      } catch (err) {
        reject(new Error('Could not parse backup file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

export function resetData() {
  localStorage.removeItem(STORAGE_KEY);
  return createDefaultState();
}
