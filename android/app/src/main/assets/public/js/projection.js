/**
 * Masscience V2.1 — Monte Carlo projections
 */
import { PHASE, MONTE_CARLO } from './constants.js';
import { calculateFFMI, recommendedGainRange } from './calculations.js';
import {
  compositionFromBF, sampleMinicutPartition, sampleBulkPartition, applyPartition,
} from './composition.js';
import { round, clamp, daysBetween, createRng } from './utils.js';
import { calculateProjectionConfidence } from './confidence.js';

function truncatedNormal(rng, mean, sd, min, max) {
  for (let i = 0; i < 12; i++) {
    let u = 0; let v = 0;
    while (u <= 1e-10) u = rng();
    while (v <= 1e-10) v = rng();
    const z = mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    if (z >= min && z <= max) return z;
  }
  return clamp(mean, min, max);
}

export function runMonteCarloProjection(params) {
  const {
    profile, currentWeight, currentBf, bfUncertainty = 2.5,
    rateMean, rateSE, remainingWeeks, phase, daysInPhase, maxBf,
  } = params;

  const rng = createRng(MONTE_CARLO.SEED + Math.round(currentWeight * 10));
  const n = MONTE_CARLO.SIMULATIONS;
  const weights = [];
  const bfs = [];
  const leanMasses = [];
  let exceed = 0;

  for (let i = 0; i < n; i++) {
    const rate = truncatedNormal(rng, rateMean, rateSE, rateMean - 3 * rateSE, rateMean + 3 * rateSE);
    const wChange = rate * remainingWeeks;
    const startBf = clamp(truncatedNormal(rng, currentBf, bfUncertainty, 3, 50), 3, 50);
    const { fatMass, leanMass } = compositionFromBF(currentWeight, startBf);

    let part;
    if (phase === PHASE.MINICUT) {
      part = applyPartition(wChange, sampleMinicutPartition(rng, daysInPhase));
    } else {
      const p = sampleBulkPartition(rng, profile.trainingYears, startBf);
      part = { fatChange: wChange * p.fat, leanChange: wChange * p.lean, waterChange: 0 };
    }

    const endWeight = currentWeight + wChange;
    const endFat = fatMass + part.fatChange;
    const endLean = leanMass + part.leanChange;
    const endBf = clamp((endFat / endWeight) * 100, 3, 50);

    weights.push(endWeight);
    bfs.push(endBf);
    leanMasses.push(endLean);
    if (endBf > maxBf) exceed++;
  }

  weights.sort((a, b) => a - b);
  bfs.sort((a, b) => a - b);
  leanMasses.sort((a, b) => a - b);
  const p = (arr, q) => arr[Math.floor(arr.length * q)];

  return {
    weight: { estimate: round(p(weights, 0.5), 1), low: round(p(weights, 0.16), 1), high: round(p(weights, 0.84), 1) },
    bf: { estimate: round(p(bfs, 0.5), 1), low: round(p(bfs, 0.16), 1), high: round(p(bfs, 0.84), 1) },
    leanMass: { estimate: round(p(leanMasses, 0.5), 1), low: round(p(leanMasses, 0.16), 1), high: round(p(leanMasses, 0.84), 1) },
    ffmi: {
      estimate: round(calculateFFMI(p(leanMasses, 0.5), profile.heightCm), 1),
      low: round(calculateFFMI(p(leanMasses, 0.16), profile.heightCm), 1),
      high: round(calculateFFMI(p(leanMasses, 0.84), profile.heightCm), 1),
    },
    modelProbabilityExceedCeiling: exceed / n,
    confidence: calculateProjectionConfidence({ trendConfidence: 65, bfConfidence: 55, weeksAhead: remainingWeeks }).score,
    simulations: n,
  };
}

export function projectCycleEnd(state, trendData, bfEstimate, gainRange, settings) {
  const cycle = state.currentCycle;
  if (!cycle || !trendData?.latest) return null;
  const mc = runMonteCarloProjection({
    profile: state.profile,
    currentWeight: trendData.latest.trend,
    currentBf: bfEstimate.estimate,
    bfUncertainty: bfEstimate.uncertainty,
    rateMean: trendData.rate?.perWeek ?? gainRange.target,
    rateSE: trendData.rate?.standardError ?? 0.15,
    remainingWeeks: getPhaseProgress(cycle).remainingWeeks,
    phase: cycle.phase,
    daysInPhase: getPhaseProgress(cycle).dayInPhase,
    maxBf: typeof cycle.maxBf === 'object' ? cycle.maxBf.point : cycle.maxBf,
    settings,
  });
  return { ...mc, remainingWeeks: getPhaseProgress(cycle).remainingWeeks };
}

export function projectFullCycle(state, trendData, bfEstimate, settings) {
  const cycle = state.currentCycle;
  if (!cycle) return [];
  const gainRange = recommendedGainRange(state.profile, cycle.phase, trendData?.latest?.trend);
  const rate = trendData?.rate?.perWeek ?? gainRange.target;
  const pp = getPhaseProgress(cycle);

  const milestones = [{
    label: 'Today',
    weight: trendData?.latest?.trend ?? state.profile.weightKg,
    bf: `~${bfEstimate.low}–${bfEstimate.high}`,
  }];

  if (cycle.phase === PHASE.BULK) {
    const proj = projectCycleEnd(state, trendData, bfEstimate, gainRange, settings);
    if (proj) {
      milestones.push({
        label: 'End Bulk',
        weight: proj.weight.estimate,
        weightRange: `${proj.weight.low}–${proj.weight.high}`,
        bf: `${proj.bf.low}–${proj.bf.high}`,
        ffmi: proj.ffmi.estimate,
      });
      const miniRate = recommendedGainRange(state.profile, PHASE.MINICUT, proj.weight.estimate).target;
      const mini = runMonteCarloProjection({
        profile: state.profile,
        currentWeight: proj.weight.estimate,
        currentBf: proj.bf.estimate,
        bfUncertainty: bfEstimate.uncertainty,
        rateMean: miniRate,
        rateSE: 0.18,
        remainingWeeks: settings.minicutWeeks,
        phase: PHASE.MINICUT,
        daysInPhase: 1,
        maxBf: cycle.maxBf,
        settings,
      });
      milestones.push({
        label: 'After Minicut',
        weight: mini.weight.estimate,
        weightRange: `${mini.weight.low}–${mini.weight.high}`,
        bf: `${mini.bf.low}–${mini.bf.high}`,
      });
    }
  }
  return milestones;
}

export function runScenario(profile, settings, params) {
  const { gainRatePerWeek = 0.2, bulkWeeks = settings.bulkWeeks, minicutWeeks = settings.minicutWeeks } = params;
  const bulkMc = runMonteCarloProjection({
    profile, currentWeight: profile.weightKg, currentBf: profile.bodyFatPercent, bfUncertainty: 2.5,
    rateMean: gainRatePerWeek, rateSE: 0.05, remainingWeeks: bulkWeeks, phase: PHASE.BULK,
    daysInPhase: bulkWeeks * 7, maxBf: profile.bodyFatPercent + 3, settings,
  });
  const miniRate = -recommendedGainRange(profile, PHASE.MINICUT, profile.weightKg).target;
  const miniMc = runMonteCarloProjection({
    profile, currentWeight: bulkMc.weight.estimate, currentBf: bulkMc.bf.estimate, bfUncertainty: 3,
    rateMean: miniRate, rateSE: 0.15, remainingWeeks: minicutWeeks, phase: PHASE.MINICUT,
    daysInPhase: 1, maxBf: profile.bodyFatPercent + 3, settings,
  });
  return {
    gainRate: gainRatePerWeek,
    bulk: fmt(bulkMc),
    minicut: fmt(miniMc),
    modelProbabilityExceedCeiling: bulkMc.modelProbabilityExceedCeiling,
  };
}

function fmt(mc) {
  return {
    weight: mc.weight.estimate, weightRange: `${mc.weight.low}–${mc.weight.high}`,
    bf: mc.bf.estimate, bfRange: `${mc.bf.low}–${mc.bf.high}`,
    ffmi: mc.ffmi.estimate,
  };
}

export function generateScenarios(profile, settings) {
  const w = profile.weightKg;
  const gr = recommendedGainRange(profile, PHASE.BULK, w);
  return [gr.min, gr.target, gr.max, gr.max * 1.15].map(r => runScenario(profile, settings, { gainRatePerWeek: round(r, 3) }));
}

export function getPhaseProgress(cycle) {
  if (!cycle) return { currentWeek: 0, totalWeeks: 0, remainingWeeks: 0, dayInPhase: 0, daysSinceStart: 0 };
  const todayStr = new Date().toISOString().split('T')[0];
  const daysSinceStart = daysBetween(cycle.phaseStartDate, todayStr);
  const currentWeek = Math.min(Math.floor(daysSinceStart / 7) + 1, cycle.phaseWeeks);
  return {
    currentWeek, totalWeeks: cycle.phaseWeeks,
    remainingWeeks: Math.max(cycle.phaseWeeks - currentWeek + 1, 0),
    dayInPhase: daysSinceStart + 1, daysSinceStart,
  };
}

export function getCalibrationProgress(cycle) {
  if (!cycle?.calibrating) return null;
  const day = daysBetween(cycle.startDate, new Date().toISOString().split('T')[0]) + 1;
  return { day: Math.min(day, 10), total: 10, complete: day >= 10 };
}
