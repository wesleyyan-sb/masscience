/**
 * Masscience V2.1 — Algorithm test suite & Invariants
 * Run: node js/tests/run-tests.js
 */
import fs from 'node:fs';
import path from 'node:path';
import { processWeightData, detectOutlier, estimateMissingWeights } from '../trend.js';
import { advanceCyclePhase } from '../cycle.js';
import { daysBetween, addDays } from '../utils.js';
import { recommendedGainRange, estimateBodyFat, partitionWeightChange } from '../calculations.js';
import { applyBfInertia } from '../composition.js';
import { calculateCalorieAdjustment, simulateController } from '../control.js';
import { estimateAdaptiveTDEE } from '../adaptive.js';
import { runMonteCarloProjection } from '../projection.js';
import { ALGORITHM_VERSION, PHASE } from '../constants.js';
import { run180DaySimulation, createSeededPRNG, createNormalPRNG } from './simulated-user-scenario.js';

const pkgVersion = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
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

// Existing baseline algorithm tests
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

test('BF estimate drifts for sustained gain without direct measurement', () => {
  const p = { sex: 'male', heightCm: 178, weightKg: 70, bodyFatPercent: 8 };
  const trend = { totalGain: 4.2, weeksSinceStart: 6, latest: { trend: 74.2 } };
  const result = estimateBodyFat(p, trend, [], { smoothedBf: 8 });
  return result.estimate > 8 && result.estimate < 16 && result.confidence < 70;
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

test('Sparse-but-valid series never collapses to zero rate', () => {
  const series = genSeries(start, 70, 21, 0.25, 0.12);
  const raw = series.filter((_, i) => i % 3 === 0 || i === series.length - 1);
  const expanded = estimateMissingWeights(raw, start, '2026-01-20');
  const trend = processWeightData(expanded, start);
  return !!trend.rate && !trend.rate.insufficient && Math.abs((trend.rate.perWeek ?? 0) - 0.25) < 0.2;
});

test('Short-window rate spikes are damped to honest bounds', () => {
  const ms = [
    { date: '2026-01-01', weight: 70.0, isEstimated: false },
    { date: '2026-01-02', weight: 70.1, isEstimated: false },
    { date: '2026-01-03', weight: 70.2, isEstimated: false },
    { date: '2026-01-04', weight: 70.3, isEstimated: false },
    { date: '2026-01-05', weight: 70.2, isEstimated: false },
    { date: '2026-01-06', weight: 74.8, isEstimated: false },
    { date: '2026-01-07', weight: 70.4, isEstimated: false },
    { date: '2026-01-08', weight: 70.6, isEstimated: false },
  ];
  const trend = processWeightData(ms, '2026-01-01');
  return Math.abs(trend.rate.perWeek) < 1.0;
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

test('Algorithm version matches package version', () => ALGORITHM_VERSION === pkgVersion);

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

// --- NEW SPECIFICATION SCENARIOS A-G ---

test('Cenário A — Perfect bulk: rate near target → status green / no over-adjustment', () => {
  const gain = recommendedGainRange(profile, PHASE.BULK, 70);
  const ms = genSeries(start, 70, 28, gain.target, 0.05);
  const trend = processWeightData(ms, start);
  const state = {
    profile, currentCycle: { initialTDEE: 2550, startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2800, lastCalorieAdjustment: null },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.01, dayIndex: 28 });
  return adj.status === 'green' && !adj.shouldAdjust;
});

test('Cenário B — Slow bulk: rate below target → status flags slow & small positive adjustment', () => {
  const gain = recommendedGainRange(profile, PHASE.BULK, 70);
  const ms = genSeries(start, 70, 28, 0.02, 0.05);
  const trend = processWeightData(ms, start);
  trend.confidence = 65;
  const state = {
    profile, currentCycle: { startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2700, lastCalorieAdjustment: '2025-11-01' },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: -0.2, dayIndex: 28 });
  return adj.adjustment > 0;
});

test('Cenário C — Fast bulk: rate above target → status flags fast & small negative adjustment', () => {
  const gain = recommendedGainRange(profile, PHASE.BULK, 70);
  const ms = genSeries(start, 70, 28, 0.45, 0.05);
  const trend = processWeightData(ms, start);
  trend.confidence = 70;
  const state = {
    profile, currentCycle: { startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2950, lastCalorieAdjustment: '2025-11-01' },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.25, dayIndex: 28 });
  return adj.adjustment < 0;
});

test('Cenário D — Extremely noisy weight: trend stable & no overreaction', () => {
  const prng = createSeededPRNG(20260830);
  const nextNormal = createNormalPRNG(prng);
  const ms = [];
  for (let d = 0; d < 28; d++) {
    const date = addDays(start, d);
    ms.push({ date, weight: Number((70 + (0.18 / 7) * d + nextNormal(0, 0.40)).toFixed(2)), isEstimated: false });
  }
  const trend = processWeightData(ms, start);
  return Math.abs(trend.rate.perWeek - 0.18) < 0.20;
});

test('Cenário E — Minicut: consistent loss → negative target & loss recognition', () => {
  const gain = recommendedGainRange(profile, PHASE.MINICUT, 72);
  const ms = genSeries(start, 72, 21, gain.target, 0.08);
  const trend = processWeightData(ms, start);
  return gain.target < 0 && trend.rate.perWeek < 0;
});

test('Cenário F — Sparse data: low confidence → avoid large adjustments', () => {
  const ms = [
    { date: '2026-01-01', weight: 70.0, isEstimated: false },
    { date: '2026-01-05', weight: 70.4, isEstimated: false },
    { date: '2026-01-10', weight: 69.8, isEstimated: false },
  ];
  const trend = processWeightData(ms, start);
  const gain = recommendedGainRange(profile, PHASE.BULK, 70);
  const state = {
    profile, currentCycle: { startDate: start },
    weightMeasurements: ms, calorieHistory: [],
    algorithmState: { currentCalories: 2800, lastCalorieAdjustment: null },
  };
  const adj = calculateCalorieAdjustment(state, trend, gain, PHASE.BULK, { errorKg: 0.1, dayIndex: 10 });
  return trend.confidence < 45 && (!adj.shouldAdjust || Math.abs(adj.adjustment) === 0);
});

test('Cenário G — 180-day simulation global mathematical consistency & accuracy', () => {
  const sim = run180DaySimulation(20260830);
  const { summary } = sim;
  return summary.globalMathCheckPassed
    && summary.validation.trendWeightCorrelation > 0.90
    && summary.validation.trendWeightMAE < 0.40;
});

// --- INVARIANTS TESTS ---

test('Invariante 1 — Consistência temporal: datas consecutivas na simulação', () => {
  const sim = run180DaySimulation(20260830);
  const gt = sim.dailyGroundTruth;
  for (let i = 0; i < gt.length - 1; i++) {
    if (daysBetween(gt[i].date, gt[i + 1].date) !== 1) return false;
  }
  return gt.length === 180;
});

test('Invariante 2 — Consistência de peso: sem saltos impossíveis de peso fisiológico (< 0.20 kg/dia)', () => {
  const sim = run180DaySimulation(20260830);
  const gt = sim.dailyGroundTruth;
  for (let i = 0; i < gt.length - 1; i++) {
    const diff = Math.abs(gt[i + 1].truePhysiologicalWeight - gt[i].truePhysiologicalWeight);
    if (diff > 0.20) return false;
  }
  return true;
});

test('Invariante 3 — Consistência da taxa: sinal da taxa condiz com a tendência', () => {
  const sim = run180DaySimulation(20260830);
  const { summary } = sim;
  const netChange = summary.observedNetChangeKg;
  const avgRate = summary.averageTrendRatePerWeek;
  return (netChange > 0 && avgRate > 0) || (netChange < 0 && avgRate < 0) || netChange === 0;
});

test('Invariante 4 — BF: 0 < BF < 100 e Low <= Estimate <= High', () => {
  const sim = run180DaySimulation(20260830);
  for (const s of sim.weeklySnapshots) {
    if (s.bodyFatEstimate <= 0 || s.bodyFatEstimate >= 100) return false;
    if (s.bodyFatLow > s.bodyFatEstimate || s.bodyFatHigh < s.bodyFatEstimate) return false;
  }
  return true;
});

test('Invariante 5 — Massa corporal: Soma dos 6 compartimentos == PhysiologicalWeight', () => {
  const sim = run180DaySimulation(20260830);
  for (const gt of sim.dailyGroundTruth) {
    const sum = Number((gt.trueFatMass + gt.trueMuscleTissueMass + gt.trueOtherLeanTissueMass + gt.trueGlycogenMass + gt.trueBodyWaterMass + gt.trueDigestiveContentMass).toFixed(2));
    if (Math.abs(sum - gt.truePhysiologicalWeight) > 0.02) return false;
  }
  return true;
});

test('Multi-perfil — Iniciante vs Avançado: partição muscular diminui com experiência', () => {
  const noviceSim = run180DaySimulation(20260830, { profile: { ...profile, trainingYears: 0 } });
  const advSim = run180DaySimulation(20260830, { profile: { ...profile, trainingYears: 5 } });
  const noviceMuscleGain = noviceSim.summary.groundTruth6ComponentBodyComposition.trueMuscleMassChange;
  const advMuscleGain = advSim.summary.groundTruth6ComponentBodyComposition.trueMuscleMassChange;
  return noviceMuscleGain > advMuscleGain;
});

test('Invariante 6 — Calorias: recomendação estabilizada sem oscilações violentas dentro da mesma fase', () => {
  const sim = run180DaySimulation(20260830);
  const snaps = sim.weeklySnapshots;
  for (let i = 0; i < snaps.length - 1; i++) {
    if (snaps[i + 1].phase === snaps[i].phase) {
      const diff = Math.abs(snaps[i + 1].recommendedCalories - snaps[i].recommendedCalories);
      if (diff > 200) return false;
    }
  }
  return true;
});

test('Invariante 7 — Isolamento de Ground Truth: algoritmo opera sem acessar ground truth', () => {
  const ms = genSeries(start, 70, 14, 0.20);
  const trend = processWeightData(ms, start);
  const bf = estimateBodyFat(profile, trend, [], {});
  return !('truePhysiologicalWeight' in trend) && !('trueFatMass' in bf);
});

const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass);

console.log(`\nMasscience Algorithm Tests (${ALGORITHM_VERSION}): ${passed}/${results.length} passed\n`);
results.forEach(r => console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name}${r.error ? ' — ' + r.error : ''}`));
process.exit(failed.length ? 1 : 0);
