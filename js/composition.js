/**
 * Masscience V2.1 — Composition system (separate from control)
 */
import { BODY_COMP, PHASE } from './constants.js';
import { clamp, round, daysBetween, today } from './utils.js';
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
    alphaOverride = null,
  } = ctx;

  const alpha = alphaOverride ?? (hasDirectMeasurement ? BODY_COMP.BF_SMOOTH_ALPHA_MEASURED : BODY_COMP.BF_SMOOTH_ALPHA_DEFAULT);
  let target = prev + alpha * (fusedValue - prev);

  const maxChange = Math.max(
    BODY_COMP.BF_MAX_CHANGE_PER_WEEK * weeksElapsed,
    Math.abs(weightChangeKg) * BODY_COMP.BF_MAX_CHANGE_PER_KG,
    hasDirectMeasurement ? 0.4 : 0.08
  );

  return clamp(target, prev - maxChange, prev + maxChange);
}

function estimateDirectionSustainedDays(trendData, algorithmState) {
  const series = trendData?.series ?? [];
  const recentWeeks = algorithmState?.recentWeightDirection ?? [];
  let sustainedDays = 0;
  let lastDir = 0;
  for (let i = 0; i < recentWeeks.length; i++) {
    const entry = recentWeeks[i];
    if (entry.direction === 0) { sustainedDays = 0; lastDir = 0; continue; }
    if (entry.direction === lastDir || lastDir === 0) {
      sustainedDays += entry.days ?? 7;
      lastDir = entry.direction;
    } else {
      sustainedDays = entry.days ?? 7;
      lastDir = entry.direction;
    }
  }
  if (sustainedDays === 0 && (trendData?.totalGain != null) && (trendData?.weeksSinceStart != null)) {
    const g = Number(trendData.totalGain) || 0;
    const w = Number(trendData.weeksSinceStart) || 0;
    const magnitudePerWeek = w > 0.2 ? Math.abs(g) / w : 0;
    if (Math.abs(g) >= 0.9 && w >= 3 && magnitudePerWeek >= 0.08) {
      sustainedDays = Math.max(10, Math.min(Math.round(w * 7), 35));
      lastDir = g > 0 ? 1 : -1;
    }
  }
  if (sustainedDays === 0 && series.length >= 8) {
    const early = series.slice(0, Math.min(series.length, 7)).reduce((a, s) => a + (s.trend ?? 0), 0) / Math.min(series.length, 7);
    const late = series.slice(-Math.min(series.length, 7)).reduce((a, s) => a + (s.trend ?? 0), 0) / Math.min(series.length, 7);
    const delta = late - early;
    if (Math.abs(delta) > 0.15) {
      sustainedDays = 10;
      lastDir = delta > 0 ? 1 : -1;
    }
  }
  return { days: clamp(sustainedDays, 0, 90), direction: lastDir };
}

function phaseTransitionDiscount(sustainedDaysObj) {
  if (sustainedDaysObj.direction === 0) return 0.20;
  const d = sustainedDaysObj.days;
  if (d <= 3) return 0.18;
  if (d <= 7) return 0.35;
  if (d <= 14) return 0.60;
  if (d <= 21) return 0.82;
  return 1.0;
}

function adaptiveFatFrac(isGain, sustainedDaysObj, phase, daysInPhase) {
  const earlyCut = phase === PHASE.MINICUT && (daysInPhase ?? 999) <= 10;
  const earlyBulk = phase === PHASE.BULK && (daysInPhase ?? 999) <= 8;
  const t = clamp(sustainedDaysObj.days / 16, 0, 1);
  if (isGain) {
    if (earlyBulk) return 0.48 + 0.15 * t;
    return 0.68 + 0.04 * t;
  }
  // In minicut, fluid/glycogen/gut depletion accounts for ~50-60% of total scale loss.
  // Attributing >50% of raw scale loss to fat creates massive over-estimation of fat loss
  // which causes systematic downward bias in body fat percentage.
  if (phase === PHASE.MINICUT) {
    if (earlyCut) return 0.28 + 0.10 * t;
    return 0.42 + 0.06 * t;
  }
  return 0.65 + 0.10 * t;
}

function expectedTransientShare(phase, daysInPhase, weightDeltaKg) {
  if (!phase || Math.abs(weightDeltaKg) < 0.05) return 0;
  const d = daysInPhase ?? 999;
  if (phase === PHASE.MINICUT && weightDeltaKg < 0 && d <= 12) {
    return clamp(0.50 - d * 0.04, 0.10, 0.50);
  }
  if (phase === PHASE.BULK && weightDeltaKg > 0 && d <= 10) {
    return clamp(0.35 - d * 0.03, 0.05, 0.35);
  }
  return 0.04;
}

function updateDirectionHistory(algorithmState, totalGain, weeksElapsed, baselineWeight) {
  const history = algorithmState?.recentWeightDirection ? [...algorithmState.recentWeightDirection] : [];
  if (weeksElapsed >= 0.8 && Math.abs(totalGain) > 0.08) {
    const dir = totalGain > 0 ? 1 : -1;
    history.push({
      days: Math.round(weeksElapsed * 7),
      direction: dir,
      totalGain,
      timestamp: Date.now ? Date.now() : history.length,
    });
  } else if (weeksElapsed >= 0.8) {
    history.push({
      days: Math.round(weeksElapsed * 7),
      direction: 0,
      totalGain,
      timestamp: history.length,
    });
  }
  while (history.length > 12) history.shift();
  return history;
}

export function estimateBodyComposition(profile, trendData, bodyMeasurements = [], algorithmState = {}) {
  const fusion = fuseBfSources(profile, bodyMeasurements);
  const prevBf = algorithmState.smoothedBf ?? profile.bodyFatPercent;
  const measuredCount = trendData?.measuredCount ?? 0;
  const observationSpan = trendData?.observationSpanDays ?? 0;
  const weeks = Math.max(observationSpan / 7, trendData?.weeksSinceStart ?? 0, 1 / 7);

  const baselineWeight = trendData?.series?.[0]?.trend ?? profile.weightKg;
  const currentTrendWeight = trendData?.latest?.trend ?? profile.weightKg;
  const totalGain = currentTrendWeight - baselineWeight;
  const hasDirectMeasurement = fusion.hasDirectMeasurement || bodyMeasurements.some(m => m?.waist && m?.neck);

  const sustainedDaysObj = estimateDirectionSustainedDays(trendData, algorithmState);
  const directionHistory = updateDirectionHistory(algorithmState, totalGain, weeks, baselineWeight);
  const transientDiscount = phaseTransitionDiscount(sustainedDaysObj);
  const phase = algorithmState.currentPhase ?? algorithmState.phase ?? null;
  const daysInPhase = algorithmState.daysInPhase ?? algorithmState.daysSincePhaseSwitch ?? 999;

  const prevTrendWeight = algorithmState.prevTrendWeightForBf ?? baselineWeight;
  const stepWeightDelta = currentTrendWeight - prevTrendWeight;
  const initialFatMass = profile.weightKg * (profile.bodyFatPercent / 100);
  let estimatedFatMass = algorithmState.estimatedFatMassKg
    ?? ((prevBf / 100) * prevTrendWeight)
    ?? initialFatMass;

  let targetBf = prevBf;
  if (hasDirectMeasurement) {
    targetBf = fusion.fused;
    estimatedFatMass = currentTrendWeight * (targetBf / 100);
  } else if (Math.abs(totalGain) >= 0.2 && currentTrendWeight > 0) {
    const transientShare = expectedTransientShare(phase, daysInPhase, stepWeightDelta);
    const tissueDelta = stepWeightDelta * (1 - transientShare);
    const fatFrac = adaptiveFatFrac(tissueDelta > 0, sustainedDaysObj, phase, daysInPhase);
    let weightImpliedFatDelta = tissueDelta * fatFrac;

    let energyImpliedFatDelta = 0;
    const intake = algorithmState.currentCalories;
    const tdee = algorithmState.estimatedTDEE;
    const asOf = trendData?.latest?.date || today();
    const lastEnergyDate = algorithmState.bfLastEnergyDate;
    if (intake && tdee && asOf) {
      const elapsedDays = lastEnergyDate
        ? clamp(daysBetween(lastEnergyDate, asOf), 0, 21)
        : clamp(Math.round(weeks * 7), 1, 10);
      if (elapsedDays > 0) {
        const dailyEB = intake - tdee;
        const energyFatFrac = dailyEB >= 0 ? 0.72 : 0.88;
        energyImpliedFatDelta = (dailyEB * elapsedDays * energyFatFrac) / 9400;
        algorithmState._bfLastEnergyDateOut = asOf;
      } else {
        algorithmState._bfLastEnergyDateOut = lastEnergyDate;
      }
    } else {
      algorithmState._bfLastEnergyDateOut = lastEnergyDate ?? null;
    }

    let deltaFat;
    if (energyImpliedFatDelta !== 0 && Math.abs(stepWeightDelta) < 0.12) {
      deltaFat = 0.40 * weightImpliedFatDelta + 0.60 * energyImpliedFatDelta;
    } else if (energyImpliedFatDelta !== 0) {
      deltaFat = 0.60 * weightImpliedFatDelta + 0.40 * energyImpliedFatDelta;
    } else {
      deltaFat = weightImpliedFatDelta;
    }

    estimatedFatMass = Math.max(1.5, estimatedFatMass + deltaFat);
    const naiveBf = clamp((estimatedFatMass / currentTrendWeight) * 100, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF);

    const targetHistory = algorithmState?.bfTargetHistory ? [...algorithmState.bfTargetHistory] : [];
    targetHistory.push(naiveBf);
    while (targetHistory.length > 6) targetHistory.shift();

    if (targetHistory.length >= 3 && !hasDirectMeasurement) {
      const recent = targetHistory.slice(-3);
      const minRecent = Math.min(...recent);
      const maxRecent = Math.max(...recent);
      const consensus = (maxRecent - minRecent) <= 1.2;
      if (!consensus) {
        targetBf = prevBf + 0.55 * (naiveBf - prevBf);
      } else {
        targetBf = naiveBf;
      }
      algorithmState._bfTargetHistoryOut = targetHistory;
    } else {
      targetBf = naiveBf;
      algorithmState._bfTargetHistoryOut = targetHistory;
    }
  } else {
    algorithmState._bfTargetHistoryOut = algorithmState?.bfTargetHistory ? [...algorithmState.bfTargetHistory] : [];
    algorithmState._bfLastEnergyDateOut = algorithmState.bfLastEnergyDate ?? null;
  }

  algorithmState._directionHistoryOut = directionHistory;

  let alpha;
  if (hasDirectMeasurement) {
    alpha = BODY_COMP.BF_SMOOTH_ALPHA_MEASURED;
  } else {
    // When derived from trend weight, trend weight is already smoothed via OLS regression.
    // Heavy lagging here creates systematic underestimation during bulk and overestimation during cut.
    alpha = clamp(
      0.80 + (Math.min(measuredCount, 20) / 20) * 0.15,
      0.75,
      0.95
    );
  }

  const estimate = applyBfInertia(prevBf, targetBf, {
    prevEstimate: prevBf,
    weeksElapsed: weeks,
    weightChangeKg: totalGain,
    hasDirectMeasurement,
    alphaOverride: alpha,
  });

  const dataQualityFactor = clamp(1 - ((Math.min(measuredCount, 20) / 20) * 0.4 + (Math.min(observationSpan, 30) / 30) * 0.3), 0.3, 1.0);

  let sigmaEff;
  if (hasDirectMeasurement) {
    sigmaEff = Math.max(0.35, Math.min(fusion.sigma, 1.0) * 0.5);
  } else {
    const baseSigma = Math.max(0.68, 0.54 + dataQualityFactor * 0.38);
    const transitionInflation = transientDiscount < 0.70 ? 1.15 : 1.0;
    const noTrendPenalty = Math.abs(totalGain) < 0.4 ? 1.08 : 1.0;
    sigmaEff = baseSigma * transitionInflation * noTrendPenalty;
  }
  const margin = round(1.96 * sigmaEff, 1);

  const conf = hasDirectMeasurement ? calculateBFConfidence(fusion.sources) : {
    score: clamp(Math.round(30 + Math.min(Math.abs(totalGain) * 4, 18) + Math.min(sustainedDaysObj.days / 3, 8)), 18, 62),
    label: 'low',
    note: 'Trend-informed BF estimate only — no direct measurement',
  };

  const bf = {
    estimate: round(estimate, 1),
    low: round(clamp(estimate - margin, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF), 1),
    high: round(clamp(estimate + margin, BODY_COMP.MIN_BF, BODY_COMP.MAX_BF), 1),
    uncertainty: round(margin, 1),
    confidence: conf.score,
    confidenceDetail: conf,
    sources: fusion.sources.map(s => s.type),
    type: 'estimated',
    heuristic: true,
    note: hasDirectMeasurement
      ? 'Estimated from direct and user inputs. High inertia applied.'
      : 'Trend-informed estimate only — no direct body-fat measurement. Low confidence.',
    smoothedBfForStorage: estimate,
  };

  return {
    bf,
    composition: compositionRange(trendData?.latest?.trend ?? profile.weightKg, bf),
    _state: {
      recentWeightDirection: algorithmState._directionHistoryOut ?? directionHistory,
      bfTargetHistory: algorithmState._bfTargetHistoryOut ?? [],
      estimatedFatMassKg: Number(estimatedFatMass.toFixed(4)),
      prevTrendWeightForBf: currentTrendWeight,
      bfLastEnergyDate: algorithmState._bfLastEnergyDateOut ?? algorithmState.bfLastEnergyDate ?? null,
    },
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
