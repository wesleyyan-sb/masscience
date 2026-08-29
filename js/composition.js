/**
 * Masscience V2.1 — Composition system (separate from control)
 */
import { BODY_COMP, PHASE } from './constants.js';
import { clamp, round } from './utils.js';
import { calculateBFConfidence } from './confidence.js';
import { navyBodyFat, compositionFromBF, compositionRange } from './calculations.js';

export function fuseBfSources(profile, bodyMeasurements = []) {
  const sources = [{
    type: 'user',
    value: profile.bodyFatPercent,
    sigma: BODY_COMP.SIGMA_USER_BF,
    weight: 1 / BODY_COMP.SIGMA_USER_BF ** 2,
  }];

  const latest = bodyMeasurements.length ? bodyMeasurements[bodyMeasurements.length - 1] : null;
  if (latest?.waist && latest?.neck) {
    const navy = navyBodyFat(profile.sex, latest.waist, latest.neck, profile.heightCm, latest.hip);
    if (navy != null) {
      sources.push({
        type: 'navy',
        value: navy,
        sigma: BODY_COMP.SIGMA_NAVY_BF,
        weight: 1 / BODY_COMP.SIGMA_NAVY_BF ** 2,
      });
    }
  }

  const sumW = sources.reduce((a, s) => a + s.weight, 0);
  return {
    fused: clamp(sources.reduce((a, s) => a + s.value * s.weight, 0) / sumW, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF),
    sigma: Math.sqrt(1 / sumW),
    sources,
    hasDirectMeasurement: sources.some(s => s.type === 'navy'),
  };
}

export function applyBfInertia(prevBf, fusedValue, ctx = {}) {
  const prev = prevBf ?? fusedValue;
  const {
    weeksElapsed = 1,
    weightChangeKg = 0,
    hasDirectMeasurement = false,
  } = ctx;

  const alpha = hasDirectMeasurement ? BODY_COMP.BF_SMOOTH_ALPHA_MEASURED : BODY_COMP.BF_SMOOTH_ALPHA_DEFAULT;
  let target = prev + alpha * (fusedValue - prev);

  const maxChange = Math.max(
    BODY_COMP.BF_MAX_CHANGE_PER_WEEK * weeksElapsed,
    Math.abs(weightChangeKg) * BODY_COMP.BF_MAX_CHANGE_PER_KG,
    hasDirectMeasurement ? 0.4 : 0.06
  );

  return clamp(target, prev - maxChange, prev + maxChange);
}

export function estimateBodyComposition(profile, trendData, bodyMeasurements = [], algorithmState = {}) {
  const fusion = fuseBfSources(profile, bodyMeasurements);
  const prevBf = algorithmState.smoothedBf ?? profile.bodyFatPercent;
  const weeks = Math.max(trendData?.weeksSinceStart ?? 0, 1 / 7);

  const estimate = applyBfInertia(prevBf, fusion.fused, {
    prevEstimate: prevBf,
    weeksElapsed: weeks,
    weightChangeKg: trendData?.totalGain ?? 0,
    hasDirectMeasurement: fusion.hasDirectMeasurement,
  });

  const uncertainty = Math.max(fusion.sigma, 2.5);
  const conf = calculateBFConfidence(fusion.sources);

  const bf = {
    estimate: round(estimate, 1),
    low: round(clamp(estimate - 1.96 * uncertainty, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF), 1),
    high: round(clamp(estimate + 1.96 * uncertainty, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF), 1),
    uncertainty: round(uncertainty, 1),
    confidence: conf.score,
    confidenceDetail: conf,
    sources: fusion.sources.map(s => s.type),
    type: 'estimated',
    heuristic: true,
    note: 'Estimated — not measured. High inertia applied.',
    smoothedBfForStorage: estimate,
  };

  return {
    bf,
    composition: compositionRange(trendData?.latest?.trend ?? profile.weightKg, bf),
  };
}

export function sampleMinicutPartition(rng, daysInPhase) {
  const ranges = daysInPhase <= BODY_COMP.MINICUT_EARLY_DAYS
    ? BODY_COMP.MINICUT_EARLY
    : BODY_COMP.MINICUT_STEADY;
  const fat = ranges.fat.min + rng() * (ranges.fat.max - ranges.fat.min);
  const lean = ranges.lean.min + rng() * (ranges.lean.max - ranges.lean.min);
  const water = Math.max(0.02, 1 - fat - lean);
  const sum = fat + lean + water;
  return { fat: fat / sum, lean: lean / sum, water: water / sum };
}

export function sampleBulkPartition(rng, trainingYears, bodyFatPercent) {
  let lo = BODY_COMP.BULK_LEAN_FRAC.min;
  let hi = BODY_COMP.BULK_LEAN_FRAC.max;
  if (trainingYears >= 5) { lo -= 0.06; hi -= 0.08; }
  if (trainingYears < 2) { lo += 0.05; hi += 0.04; }
  if (bodyFatPercent > 18) { lo -= 0.05; hi -= 0.05; }
  const lean = lo + rng() * (hi - lo);
  return { lean, fat: 1 - lean };
}

export function applyPartition(wChange, part) {
  return {
    fatChange: wChange * part.fat,
    leanChange: wChange * part.lean,
    waterChange: wChange * (part.water ?? 0),
  };
}

export { compositionFromBF, compositionRange };
