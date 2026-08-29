/**
 * Masscience — localStorage persistence
 */
import { STORAGE_KEY, ALGORITHM_VERSION, APP_VERSION } from './constants.js';
import { today, daysBetween } from './utils.js';

const AUTO_BACKUP_KEY = 'masscience_backup_latest';
const BACKUP_HISTORY_KEY = 'masscience_backup_history';
const AUTO_BACKUP_MAX = 5;

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
    lastSavedAt: today(),
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
  const snapshot = { ...state, lastSavedAt: today() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  saveAutoBackup(snapshot);
}

export function saveAutoBackup(state) {
  const backup = {
    timestamp: new Date().toISOString(),
    date: today(),
    data: { ...state, lastSavedAt: today() },
  };

  try {
    const history = JSON.parse(localStorage.getItem(BACKUP_HISTORY_KEY) || '[]');
    const nextHistory = [backup, ...history.filter(item => item && item.date !== backup.date)].slice(0, AUTO_BACKUP_MAX);
    localStorage.setItem(BACKUP_HISTORY_KEY, JSON.stringify(nextHistory));
    localStorage.setItem(AUTO_BACKUP_KEY, JSON.stringify(backup));
  } catch {
    // no-op: backup best effort only
  }
}

export function getLatestBackup() {
  try {
    const snapshot = localStorage.getItem(AUTO_BACKUP_KEY);
    return snapshot ? JSON.parse(snapshot) : null;
  } catch {
    return null;
  }
}

export function restoreLatestBackup() {
  const latest = getLatestBackup();
  if (!latest || !latest.data) throw new Error('No backup snapshot available.');
  return migrateState(latest.data);
}

export function clearAutoBackups() {
  localStorage.removeItem(AUTO_BACKUP_KEY);
  localStorage.removeItem(BACKUP_HISTORY_KEY);
}

export function getDataHealthSummary(state) {
  const lastSavedAt = state?.lastSavedAt || today();
  const daysSinceSave = daysBetween(lastSavedAt, today());
  const problems = [];

  if (daysSinceSave > 120) problems.push('Data is older than 120 days; consider creating a backup and checking the latest weigh-ins.');
  if (!state?.onboarded) problems.push('Profile is not fully onboarded yet.');
  if (!state?.currentCycle && state?.onboarded) problems.push('Current cycle is missing.');

  return {
    daysSinceSave,
    warnings: problems,
    healthy: problems.length === 0,
    latestBackup: getLatestBackup(),
  };
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
