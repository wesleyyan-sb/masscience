/**
 * Masscience Algorithm V2.1 — Constants
 * See ARCHITECTURE.md. Values marked (H) are heuristics, not lab-validated.
 */
export const ALGORITHM_VERSION = '2.1.1';
export const APP_VERSION = '2.1.1';
export const STORAGE_KEY = 'masscience_data';

export const CYCLE = {
  BULK_WEEKS: 10,
  MINICUT_WEEKS: 3,
  CALIBRATION_DAYS: 10,
  EOD_EVAL_DAYS: 7,
};

export const CALORIES = {
  INITIAL_BULK_SURPLUS: 300,
  INITIAL_MINICUT_DEFICIT: 500,
  KCAL_PER_KG: 7700,
  KCAL_PER_KG_MIN: 7000,
  KCAL_PER_KG_MAX: 9000,
  ADJUSTMENT_STEPS: [50, 100, 150, 200],
  ADJUSTMENT_COOLDOWN_DAYS: 7,
  DEADBAND_KG_PER_WEEK: 0.025,
  DEADBAND_PERCENT_BW_WEEK: 0.035,
  MIN_CALORIES_MALE: 1500,
  MIN_CALORIES_FEMALE: 1200,
  MAX_CALORIES: 5000,
  MIN_CALORIES_ABSOLUTE: 1200,
};

/** V2.1: Rolling OLS — Huber removed after benchmark showed marginal benefit */
export const TREND = {
  MIN_MEASUREMENTS: 3,
  MIN_MEASUREMENTS_FOR_RATE: 5,
  WINDOW_MIN_DAYS: 7,
  WINDOW_MAX_DAYS: 21,
  WINDOW_DEFAULT_DAYS: 14,
  WEIGHT_MEASURED: 1.0,
  WEIGHT_ESTIMATED: 0.10,
  WEIGHT_OUTLIER: 0.06,
  OUTLIER_MAD_THRESHOLD: 3.5,
  OUTLIER_FIXED_KG: 0.9,
  OUTLIER_MIN_SAMPLE: 5,
  MAX_ESTIMATED_STREAK: 5,
};

export const TDEE = {
  MIN_OBSERVATION_DAYS: 14,
  LEARNING_RATE: 0.20,
  MIN_KCAL: 1200,
  MAX_KCAL: 6000,
  MAX_WEEKLY_SHIFT: 150,
  INTAKE_UNCERTAINTY_KCAL: 250,
  INITIAL_CONFIDENCE: 20,
};

export const BODY_COMP = {
  MIN_BF: 3,
  MAX_BF: 50,
  /** (H) heuristic spread for fusion — not validated SDs */
  SIGMA_USER_BF: 3.0,
  SIGMA_NAVY_BF: 4.0,
  BULK_LEAN_FRAC: { min: 0.40, mid: 0.55, max: 0.70 },
  /** Minicut partition RANGES (H) — sampled in MC, not fixed */
  MINICUT_EARLY: {
    fat: { min: 0.08, max: 0.35 },
    lean: { min: 0.04, max: 0.18 },
  },
  MINICUT_STEADY: {
    fat: { min: 0.55, max: 0.82 },
    lean: { min: 0.08, max: 0.22 },
  },
  MINICUT_EARLY_DAYS: 7,
  /** BF inertia (H) */
  BF_MAX_CHANGE_PER_WEEK: 0.12,
  BF_MAX_CHANGE_PER_KG: 0.03,
  BF_SMOOTH_ALPHA_MEASURED: 0.30,
  BF_SMOOTH_ALPHA_DEFAULT: 0.05,
};

export const GAIN_RATE = {
  BASE_PCT_MIN: 0.15,
  BASE_PCT_TARGET: 0.25,
  BASE_PCT_MAX: 0.40,
  NOVICE_PCT_BONUS: 0.06,
  ADVANCED_PCT_PENALTY: 0.10,
  LOW_BF_PCT_BONUS: 0.04,
  HIGH_BF_PCT_PENALTY: 0.10,
  MINICUT_PCT_MIN: 0.35,
  MINICUT_PCT_MAX: 0.85,
  MINICUT_PCT_TARGET: 0.55,
};

export const MACROS = {
  PROTEIN_G_PER_KG: { min: 1.6, target: 2.0, max: 2.4 },
  FAT_G_PER_KG: { min: 0.6, target: 0.8 },
  FAT_MIN_KCAL_PERCENT: 0.20,
};

export const WATER = {
  BASE_ML_PER_KG: 35,
  TRAINING_BONUS_ML: 450,
  ACTIVITY_BONUS: { sedentary: 0, lightly_active: 250, moderately_active: 500, very_active: 750, extremely_active: 1000 },
};

export const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extremely_active: 1.9,
};

export const WEIGH_IN = {
  DAILY: 'daily',
  EVERY_OTHER: 'every_other',
  THREE_WEEKLY: 'three_weekly',
  CONFIDENCE_DOWNGRADE_EOD: 62,
  CONFIDENCE_DOWNGRADE_3X: 75,
  CONFIDENCE_UPGRADE_EOD: 48,
  CONFIDENCE_UPGRADE_DAILY: 32,
};

export const STATUS = { GREEN: 'green', YELLOW: 'yellow', RED: 'red', NEUTRAL: 'neutral' };
export const PHASE = { BULK: 'bulk', MINICUT: 'minicut' };

/** 800 sims — convergence test showed <2% shift vs 5000 */
export const MONTE_CARLO = {
  SIMULATIONS: 800,
  SEED: 42,
};

export const BODY_CHECK_INTERVAL_DAYS = 21;
