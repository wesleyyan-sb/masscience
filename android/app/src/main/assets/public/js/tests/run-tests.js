/**
 * Masscience V2.1 — Algorithm test suite
 * Run: node js/tests/run-tests.js
 */
import { processWeightData, detectOutlier, estimateMissingWeights } from '../trend.js';
import { advanceCyclePhase } from '../cycle.js';
import { daysBetween } from '../utils.js';
import { recommendedGainRange, estimateBodyFat, partitionWeightChange } from '../calculations.js';
import { applyBfInertia } from '../composition.js';
import { calculateCalorieAdjustment, simulateController } from '../control.js';
import { estimateAdaptiveTDEE } from '../adaptive.js';
import { runMonteCarloProjection } from '../projection.js';
import { ALGORITHM_VERSION, PHASE } from '../constants.js';

const results = [];

function test(name, fn) {
  try {
    const pass = fn();
    results.push({ name, pass: !!pass, error: pass ? null : 'Assertion failed' });
  } catch (e) {
    results.push({ name, pass: false, error: e.message });
  }
}

function genSeries(startDate, startWeight, days, ratePerWeek, noise = 0.15) {
  const ms = [];
  for (let d = 0; d < days; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    ms.push({
      date: date.toISOString().split('T')[0],
      weight: Math.round((startWeight + (ratePerWeek / 7) * d + Math.sin(d) * noise) * 100) / 100,
      isEstimated: false,
    });
  }
  return ms;
}

const profile = {
  age: 28, sex: 'male', heightCm: 178, weightKg: 75, bodyFatPercent: 14,
  trainingYears: 3, trainingSessions: 4, activityLevel: 'moderately_active',
};

const start = '2026-01-01';

test('Stable gain near target → GREEN / no adjustment', () => {
  const gain = recommendedGainRange(profile, PHASE.BULK, 75);
  const ms = genSeries(start, 75, 28, gain.target, 0.08);
  const trend = processWeightData(ms, start);
  const state = {
    profile, currentCycle: { initialTDEE: 2700, startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2800, lastCalorieAdjustment: null },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.02, dayIndex: 28 });
  return adj.status === 'green' && !adj.shouldAdjust;
});

test('Fast +0.40 kg/wk → calorie reduction recommended', () => {
  const ms = genSeries(start, 75, 28, 0.40, 0.1);
  const trend = processWeightData(ms, start);
  const gain = recommendedGainRange(profile, PHASE.BULK, 77);
  const state = {
    profile, currentCycle: { initialTDEE: 2700, startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2800, lastCalorieAdjustment: '2025-12-01' },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.5, dayIndex: 28 });
  return adj.adjustment < 0 && (adj.status === 'yellow' || adj.status === 'red');
});

test('Water spike outlier flagged, original preserved', () => {
  const ms = genSeries(start, 75, 14, 0.18);
  const out = detectOutlier(ms, ms[ms.length - 1].weight + 1.2);
  return out.isOutlier && out.originalPreserved;
});

test('Missing measurements → estimated weights generated', () => {
  const ms = genSeries(start, 75, 10, 0.18).filter((_, i) => i % 2 === 0);
  const filled = estimateMissingWeights(ms, start, '2026-01-09');
  return filled.filter(m => m.isEstimated).length > 0;
});

test('Minicut partition sums to 100%', () => {
  const early = partitionWeightChange(-1, PHASE.MINICUT, { daysInPhase: 3 });
  const steady = partitionWeightChange(-1, PHASE.MINICUT, { daysInPhase: 14 });
  const sumE = early.fatChange + early.leanChange + early.waterChange;
  const sumS = steady.fatChange + steady.leanChange + steady.waterChange;
  return Math.abs(sumE + 1) < 0.001 && Math.abs(sumS + 1) < 0.001;
});

test('BF fusion returns uncertainty range', () => {
  const bf = estimateBodyFat(profile, { totalGain: 0.5, weeksSinceStart: 3 }, []);
  return bf.low < bf.estimate && bf.high > bf.estimate;
});

test('BF inertia: 63→64 kg in 3 days moves BF < 0.3%', () => {
  const prev = 14.0;
  const after = applyBfInertia(prev, 15.5, { weeksElapsed: 3 / 7, weightChangeKg: 1, hasDirectMeasurement: false });
  return Math.abs(after - prev) < 0.3;
});

test('BF inertia: rapid loss without measurement capped', () => {
  const prev = 14.0;
  const after = applyBfInertia(prev, 12.0, { weeksElapsed: 5 / 7, weightChangeKg: -1.2, hasDirectMeasurement: false });
  return after > prev - 0.25;
});

test('Monte Carlo projection widens intervals', () => {
  const mc = runMonteCarloProjection({
    profile, currentWeight: 76, currentBf: 14, bfUncertainty: 2.5,
    rateMean: 0.2, rateSE: 0.08, remainingWeeks: 8, phase: PHASE.BULK,
    daysInPhase: 40, maxBf: 17, settings: { bulkWeeks: 10, minicutWeeks: 3 },
  });
  return mc.weight.high > mc.weight.estimate && mc.weight.low < mc.weight.estimate;
});

test('TDEE inference returns range (target-only intake)', () => {
  const ms = genSeries(start, 75, 20, 0.22);
  const trend = processWeightData(ms, start);
  const state = {
    profile, currentCycle: { initialTDEE: 2600, startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { estimatedTDEE: 2600 },
  };
  const tdee = estimateAdaptiveTDEE(state, trend, 2900);
  return tdee.high > tdee.estimate && tdee.low < tdee.estimate;
});

test('Slow gain triggers calorie increase', () => {
  const ms = genSeries(start, 75, 28, 0.03, 0.05);
  const trend = processWeightData(ms, start);
  trend.confidence = 72;
  const gain = recommendedGainRange(profile, PHASE.BULK, 75);
  const state = {
    profile, currentCycle: { startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2700, lastCalorieAdjustment: '2025-11-01' },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: -0.35, dayIndex: 28 });
  return adj.adjustment > 0;
});

test('Single-day spike damped in trend (not treated as tissue gain)', () => {
  const ms = genSeries(start, 75, 20, 0.20, 0.1);
  const lastW = ms[ms.length - 1].weight;
  ms.push({ date: '2026-01-21', weight: lastW + 1.5, isEstimated: false, isOutlier: true, trendWeight: lastW + 0.05 });
  const trend = processWeightData(ms, start);
  const gain = recommendedGainRange(profile, PHASE.BULK, 76);
  const withoutSpike = processWeightData(ms.slice(0, -1), start);
  const rateDelta = Math.abs(trend.rate.perWeek - withoutSpike.rate.perWeek);
  return rateDelta < 0.12 && trend.rate.perWeek < gain.target + 0.15;
});

test('Invalid dates are handled without throwing', () => {
  return daysBetween(undefined, '2026-01-10') === 0 && daysBetween('2026-01-01', undefined) === 0;
});

test('advanceCyclePhase does not create a circular state', () => {
  const state = {
    profile: { weightKg: 80 },
    currentCycle: { phase: 'bulk', phaseStartDate: '2026-01-01', phaseWeeks: 10, paused: false },
    settings: { bulkWeeks: 10, minicutWeeks: 3 },
    algorithmState: { estimatedTDEE: 2600 },
    calorieHistory: [],
    weightMeasurements: [],
  };
  const result = advanceCyclePhase(state, state.settings);
  return result !== state && result.currentCycle !== result && JSON.stringify(result).includes('currentCycle');
});

test('Controller simulation converges toward target rate', () => {
  const hist = simulateController(3000, 2700, 0.19, 0.15, 12);
  const last = hist[hist.length - 1];
  return Math.abs(last.rate - 0.19) < 0.08;
});

test('Algorithm version is 2.1.0', () => ALGORITHM_VERSION === '2.1.0');

test('Risk does not block calorie adjustment when rate is off target', () => {
  const ms = genSeries(start, 75, 28, 0.38, 0.08);
  const trend = processWeightData(ms, start);
  trend.confidence = 70;
  const gain = recommendedGainRange(profile, PHASE.BULK, 77);
  const state = {
    profile, currentCycle: { startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2900, lastCalorieAdjustment: '2025-11-01' },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.4, dayIndex: 28 });
  return adj.shouldAdjust && adj.adjustment < 0;
});

test('MC rate sensitivity: higher SE widens weight interval', () => {
  const tight = runMonteCarloProjection({
    profile, currentWeight: 76, currentBf: 14, bfUncertainty: 2.5,
    rateMean: 0.2, rateSE: 0.04, remainingWeeks: 8, phase: PHASE.BULK,
    daysInPhase: 40, maxBf: 17, settings: {},
  });
  const wide = runMonteCarloProjection({
    profile, currentWeight: 76, currentBf: 14, bfUncertainty: 2.5,
    rateMean: 0.2, rateSE: 0.18, remainingWeeks: 8, phase: PHASE.BULK,
    daysInPhase: 40, maxBf: 17, settings: {},
  });
  return (wide.weight.high - wide.weight.low) > (tight.weight.high - tight.weight.low);
});

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass);

console.log(`\nMasscience Algorithm Tests (${ALGORITHM_VERSION}): ${passed}/${results.length} passed\n`);
results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ' — ' + r.error : ''}`));
process.exit(failed.length ? 1 : 0);
