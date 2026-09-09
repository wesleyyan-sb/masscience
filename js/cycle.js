/**
 * Masscience — Cycle management engine
 */
import { CYCLE, PHASE, WEIGH_IN, BODY_CHECK_INTERVAL_DAYS, ALGORITHM_VERSION, MINICUT_CONFIG } from './constants.js';
import {
  today, daysBetween, addDays, uuid, getWeekNumber, round, median,
} from './utils.js';
import {
  initialCalorieTarget, buildInitialPlan, planMinicutEnergyTarget,
} from './calculations.js';
import {
  processWeightData, isTrendStable, isTrendUnstable, estimateMissingWeights, detectOutlier,
} from './trend.js';

export function createCycle(profile, settings, plan) {
  const startDate = today();
  const startBf = profile.bodyFatPercent;
  return {
    id: uuid(),
    number: 1,
    startDate,
    phaseStartDate: startDate,
    phase: PHASE.BULK,
    phaseWeeks: settings.bulkWeeks,
    calibrating: true,
    calibrationComplete: false,
    paused: false,
    pausedAt: null,
    initialTDEE: plan.tdee,
    initialWeight: profile.weightKg,
    startingBf: startBf,
    cycleStartingBodyFatPercentage: startBf,
    maxBf: plan.maxBf,
    algorithmVersion: ALGORITHM_VERSION,
    currentDate: startDate,
  };
}

export function advanceCyclePhase(state, settings) {
  const cycle = state.currentCycle;
  if (!cycle || cycle.paused) return state;

  const daysInPhase = daysBetween(cycle.phaseStartDate, today());

  if (cycle.phase === PHASE.BULK && daysInPhase >= cycle.phaseWeeks * 7) {
    return transitionToMinicut(state, settings);
  }

  if (cycle.phase === PHASE.MINICUT) {
    const targetBf = cycle.targetBf ?? cycle.startingBf ?? state.profile.bodyFatPercent;
    const tolerance = cycle.bodyFatTargetTolerance ?? MINICUT_CONFIG?.BF_TOLERANCE ?? 0.3;
    const currentBf = state.algorithmState.smoothedBf ?? state.profile.bodyFatPercent;
    const minDays = MINICUT_CONFIG?.MIN_STABILIZATION_DAYS ?? 14;
    const maxDays = MINICUT_CONFIG?.SAFETY_CEILING_DAYS ?? 70;

    const targetReached = currentBf <= (targetBf + tolerance);

    if (daysInPhase >= minDays && targetReached) {
      return completeCycle(state, settings, { targetReached: true, exitReason: 'MINICUT_BF_TARGET_REACHED' });
    }

    if (daysInPhase >= maxDays) {
      return completeCycle(state, settings, { targetReached, exitReason: 'MINICUT_SAFETY_CEILING_REACHED' });
    }

    // If past preferred days (21 days) but target not yet reached: mark extension
    const preferredDays = cycle.preferredDays ?? 21;
    if (daysInPhase > preferredDays) {
      cycle.extended = true;
      cycle.minicutExtensionRequired = true;
      cycle.minicutExtensionDurationDays = daysInPhase - preferredDays;
    }

    return state;
  }

  return state;
}

function transitionToMinicut(state, settings) {
  const cycle = state.currentCycle;
  const tdee = state.algorithmState.estimatedTDEE || cycle.initialTDEE;
  const currentWeight = state.profile.weightKg;
  const currentBf = state.algorithmState.smoothedBf ?? state.profile.bodyFatPercent;
  const startingBf = cycle.startingBf ?? cycle.initialBf ?? state.profile.bodyFatPercent;

  const plan = planMinicutEnergyTarget(currentWeight, currentBf, startingBf, tdee, MINICUT_CONFIG?.PREFERRED_DAYS ?? 21);
  const minicutCalories = plan.targetCalories;

  const updatedCycle = {
    ...cycle,
    phase: PHASE.MINICUT,
    phaseStartDate: today(),
    phaseWeeks: Math.ceil((plan.projectedDaysToTarget || 21) / 7),
    preferredDays: MINICUT_CONFIG?.PREFERRED_DAYS ?? 21,
    startingBf,
    targetBf: startingBf,
    bodyFatTargetTolerance: MINICUT_CONFIG?.BF_TOLERANCE ?? 0.3,
    initialRequiredDeficit: plan.requiredDeficit,
    appliedDeficit: plan.appliedDeficit,
    projectedDaysToTarget: plan.projectedDaysToTarget,
    minicutExtensionRequired: plan.extensionLikely,
    minicutExtensionDurationDays: plan.extensionDays,
    extended: false,
    calibrating: false,
  };

  return {
    ...state,
    currentCycle: updatedCycle,
    algorithmState: {
      ...state.algorithmState,
      currentCalories: minicutCalories,
      weighInFrequency: WEIGH_IN.EVERY_OTHER,
      frequencyPhaseStart: today(),
      lastCalorieAdjustment: null,
    },
    calorieHistory: [
      ...state.calorieHistory,
      {
        date: today(),
        previous: state.algorithmState.currentCalories,
        new: minicutCalories,
        adjustment: minicutCalories - state.algorithmState.currentCalories,
        reason: 'Automatic transition to minicut phase',
        status: 'neutral',
      },
    ],
  };
}

function completeCycle(state, settings, meta = {}) {
  const cycle = state.currentCycle;
  const trendData = processWeightData(state.weightMeasurements, cycle.startDate);

  const finalBf = state.algorithmState.smoothedBf ?? state.profile.bodyFatPercent;
  const startingBf = cycle.startingBf ?? cycle.initialBf ?? state.profile.bodyFatPercent;

  const summary = {
    id: cycle.id,
    number: cycle.number,
    startDate: cycle.startDate,
    endDate: today(),
    initialWeight: cycle.initialWeight,
    finalWeight: trendData.latest?.trend || cycle.initialWeight,
    initialBf: startingBf,
    startingBf,
    targetBf: cycle.targetBf ?? startingBf,
    finalBf,
    minicutBodyFatTargetError: round(finalBf - startingBf, 2),
    minicutTargetReached: meta.targetReached ?? (finalBf <= (cycle.targetBf ?? startingBf) + (MINICUT_CONFIG?.BF_TOLERANCE ?? 0.3)),
    exitReason: meta.exitReason ?? 'MINICUT_BF_TARGET_REACHED',
    minicutExtensionRequired: cycle.minicutExtensionRequired ?? false,
    minicutExtensionDurationDays: cycle.minicutExtensionDurationDays ?? 0,
    bulkWeeks: settings.bulkWeeks,
    minicutWeeks: settings.minicutWeeks,
    calorieAdjustments: state.calorieHistory.filter(c => c.date >= cycle.startDate).length,
  };

  const tdee = state.algorithmState.estimatedTDEE || cycle.initialTDEE;
  const plan = buildInitialPlan(state.profile, settings);
  const bulkCalories = initialCalorieTarget(tdee, PHASE.BULK);

  const newCycle = {
    id: uuid(),
    number: cycle.number + 1,
    startDate: today(),
    phaseStartDate: today(),
    phase: PHASE.BULK,
    phaseWeeks: settings.bulkWeeks,
    calibrating: true,
    calibrationComplete: false,
    paused: false,
    initialTDEE: tdee,
    initialWeight: trendData.latest?.trend || state.profile.weightKg,
    startingBf: finalBf,
    cycleStartingBodyFatPercentage: finalBf,
    maxBf: plan.maxBf,
    algorithmVersion: ALGORITHM_VERSION,
    currentDate: today(),
  };

  return {
    ...state,
    cycleHistory: [...state.cycleHistory, summary],
    currentCycle: newCycle,
    weightMeasurements: [],
    algorithmState: {
      ...state.algorithmState,
      currentCalories: bulkCalories,
      weighInFrequency: WEIGH_IN.DAILY,
      frequencyPhaseStart: today(),
      lastCalorieAdjustment: null,
    },
  };
}

export function pauseCycle(state) {
  if (!state.currentCycle) return state;
  return {
    ...state,
    currentCycle: { ...state.currentCycle, paused: true, pausedAt: today() },
  };
}

export function resumeCycle(state) {
  if (!state.currentCycle) return state;
  const pausedDays = state.currentCycle.pausedAt
    ? daysBetween(state.currentCycle.pausedAt, today())
    : 0;
  return {
    ...state,
    currentCycle: {
      ...state.currentCycle,
      paused: false,
      pausedAt: null,
      phaseStartDate: addDays(state.currentCycle.phaseStartDate, pausedDays),
    },
  };
}

export function resetCycle(state, settings) {
  const plan = buildInitialPlan(state.profile, settings);
  const cycle = createCycle(state.profile, settings, plan);
  return {
    ...state,
    currentCycle: cycle,
    weightMeasurements: [],
    calorieHistory: [],
    algorithmState: {
      estimatedTDEE: plan.tdee,
      tdeeConfidence: 30,
      currentCalories: plan.bulkCalories,
      weighInFrequency: WEIGH_IN.DAILY,
      frequencyPhaseStart: today(),
      lastCalorieAdjustment: null,
      consistencyScore: 0,
    },
  };
}

export function updateWeighInFrequency(state, trendData) {
  const { algorithmState, currentCycle } = state;
  if (!currentCycle || currentCycle.calibrating) return state;

  const calProgress = daysBetween(currentCycle.startDate, today()) + 1;
  if (calProgress <= CYCLE.CALIBRATION_DAYS) return state;

  let frequency = algorithmState.weighInFrequency;
  let frequencyPhaseStart = algorithmState.frequencyPhaseStart;
  let message = null;

  if (!currentCycle.calibrationComplete) {
    return {
      ...state,
      currentCycle: { ...currentCycle, calibrating: false, calibrationComplete: true },
      algorithmState: {
        ...algorithmState,
        weighInFrequency: WEIGH_IN.EVERY_OTHER,
        frequencyPhaseStart: today(),
        frequencyMessage: 'Masscience has enough data to reduce your weighing frequency.',
      },
    };
  }

  const daysInFreqPhase = daysBetween(frequencyPhaseStart, today());
  const conf = trendData?.confidence ?? 0;
  const stable = isTrendStable(trendData);
  const unstable = isTrendUnstable(trendData);

  if (conf < WEIGH_IN.CONFIDENCE_UPGRADE_DAILY && frequency !== WEIGH_IN.DAILY) {
    frequency = WEIGH_IN.DAILY;
    frequencyPhaseStart = today();
    message = 'Low trend confidence — daily weighing recommended.';
  } else if (unstable && frequency === WEIGH_IN.THREE_WEEKLY) {
    frequency = WEIGH_IN.EVERY_OTHER;
    frequencyPhaseStart = today();
    message = 'Trend uncertainty increased. Returning to every-other-day weighing.';
  } else if (unstable && frequency === WEIGH_IN.EVERY_OTHER) {
    frequency = WEIGH_IN.DAILY;
    frequencyPhaseStart = today();
    message = 'Trajectory unstable. Daily weighing recommended.';
  } else if (stable && conf >= WEIGH_IN.CONFIDENCE_DOWNGRADE_3X && frequency === WEIGH_IN.EVERY_OTHER && daysInFreqPhase >= CYCLE.EOD_EVAL_DAYS) {
    frequency = WEIGH_IN.THREE_WEEKLY;
    frequencyPhaseStart = today();
    message = 'Your trajectory is stable. You can now reduce weigh-ins to 3 days per week.';
  } else if (stable && conf >= WEIGH_IN.CONFIDENCE_DOWNGRADE_EOD && frequency === WEIGH_IN.DAILY) {
    frequency = WEIGH_IN.EVERY_OTHER;
    frequencyPhaseStart = today();
    message = 'Masscience has enough data to reduce your weighing frequency.';
  }

  if (frequency === algorithmState.weighInFrequency && !message) return state;

  return {
    ...state,
    algorithmState: {
      ...algorithmState,
      weighInFrequency: frequency,
      frequencyPhaseStart: frequencyPhaseStart || today(),
      frequencyMessage: message,
    },
  };
}

export function shouldWeighToday(state) {
  const { algorithmState, currentCycle, weightMeasurements } = state;
  if (!currentCycle || currentCycle.paused) return false;

  const todayStr = today();
  if (weightMeasurements.some(m => m.date === todayStr && !m.isEstimated)) return false;

  const dayNum = daysBetween(currentCycle.startDate, todayStr);

  if (dayNum < CYCLE.CALIBRATION_DAYS || algorithmState.weighInFrequency === WEIGH_IN.DAILY) {
    return true;
  }

  if (algorithmState.weighInFrequency === WEIGH_IN.EVERY_OTHER) {
    return dayNum % 2 === 0;
  }

  if (algorithmState.weighInFrequency === WEIGH_IN.THREE_WEEKLY) {
    const dow = new Date().getDay();
    return [1, 3, 5].includes(dow);
  }

  return true;
}

export function getNextWeighInDate(state) {
  for (let i = 0; i <= 14; i++) {
    const date = addDays(today(), i);
    const dayNum = daysBetween(state.currentCycle.startDate, date);

    if (dayNum < CYCLE.CALIBRATION_DAYS) {
      if (!state.weightMeasurements.some(m => m.date === date && !m.isEstimated)) return date;
      continue;
    }

    const freq = state.algorithmState.weighInFrequency;
    let shouldWeigh = false;

    if (freq === WEIGH_IN.DAILY) shouldWeigh = true;
    else if (freq === WEIGH_IN.EVERY_OTHER) shouldWeigh = dayNum % 2 === 0;
    else {
      const dow = new Date(date + 'T12:00:00').getDay();
      shouldWeigh = [1, 3, 5].includes(dow);
    }

    if (shouldWeigh && !state.weightMeasurements.some(m => m.date === date && !m.isEstimated)) {
      return date;
    }
  }
  return addDays(today(), 1);
}

export function isBodyCheckDue(state) {
  const checks = state.bodyMeasurements;
  if (!checks.length) {
    return daysBetween(state.currentCycle?.startDate, today()) >= BODY_CHECK_INTERVAL_DAYS;
  }
  const lastCheck = checks[checks.length - 1].date;
  return daysBetween(lastCheck, today()) >= BODY_CHECK_INTERVAL_DAYS;
}

export function addWeightMeasurement(state, weight, options = {}) {
  const date = options.date || today();
  const existing = state.weightMeasurements.findIndex(m => m.date === date && !m.isEstimated);
  const measuredHistory = state.weightMeasurements.filter(m => !m.isEstimated && m.date !== date);
  const outlier = detectOutlier(measuredHistory, weight);
  const isSodiumSpike = !!options.isSodiumSpike;

  let trendWeight = outlier.trendWeight;
  if (isSodiumSpike && trendWeight == null) {
    const recent = measuredHistory.slice(-14).map(m => m.weight);
    const med = recent.length ? median(recent) : weight;
    trendWeight = round(med + (weight - med) * 0.15, 2);
  }

  const measurement = {
    date,
    weight: Math.round(weight * 100) / 100,
    isEstimated: false,
    isOutlier: outlier.isOutlier || isSodiumSpike,
    outlierReason: isSodiumSpike ? 'sodium_spike' : (outlier.isOutlier ? 'water_spike' : null),
    isSodiumSpike,
    trendWeight: trendWeight != null ? trendWeight : Math.round(weight * 100) / 100,
    modifiedZ: outlier.modifiedZ,
  };

  let measurements = [...state.weightMeasurements];
  if (existing >= 0) measurements[existing] = measurement;
  else measurements.push(measurement);

  measurements.sort((a, b) => a.date.localeCompare(b.date));

  const withEstimates = estimateMissingWeights(
    measurements.filter(m => !m.isEstimated),
    state.currentCycle.startDate,
    date
  );

  return { ...state, weightMeasurements: withEstimates };
}

export function getCycleTimeline(cycle, settings) {
  if (!cycle) return [];

  const timeline = [];
  const bulkWeeks = settings.bulkWeeks;
  const minicutWeeks = settings.minicutWeeks;

  for (let w = 1; w <= bulkWeeks; w++) {
    const currentWeek = cycle.phase === PHASE.BULK ? getWeekNumber(cycle.phaseStartDate, today()) : bulkWeeks + 1;
    timeline.push({
      phase: PHASE.BULK,
      week: w,
      totalWeeks: bulkWeeks,
      label: `Week ${w} / ${bulkWeeks}`,
      active: cycle.phase === PHASE.BULK && currentWeek === w,
      completed: cycle.phase === PHASE.MINICUT || (cycle.phase === PHASE.BULK && currentWeek > w),
    });
  }

  for (let w = 1; w <= minicutWeeks; w++) {
    const currentWeek = cycle.phase === PHASE.MINICUT ? getWeekNumber(cycle.phaseStartDate, today()) : 0;
    timeline.push({
      phase: PHASE.MINICUT,
      week: w,
      totalWeeks: minicutWeeks,
      label: `Week ${w} / ${minicutWeeks}`,
      active: cycle.phase === PHASE.MINICUT && currentWeek === w,
      completed: cycle.phase === PHASE.MINICUT && currentWeek > w,
    });
  }

  return timeline;
}

export function getReminders(state) {
  const reminders = [];

  if (shouldWeighToday(state)) {
    reminders.push({ type: 'weigh-in', icon: '⚖️', text: 'Weigh-in today' });
  }

  if (isBodyCheckDue(state)) {
    reminders.push({ type: 'body-check', icon: '📏', text: 'Body Check due' });
  }

  const cycle = state.currentCycle;
  if (cycle && !cycle.paused) {
    const daysInPhase = daysBetween(cycle.phaseStartDate, today());
    const daysLeft = cycle.phaseWeeks * 7 - daysInPhase;
    if (daysLeft === 1 && cycle.phase === PHASE.BULK) {
      reminders.push({ type: 'phase', icon: '🔄', text: 'Minicut starts tomorrow' });
    }
    if (daysLeft === 1 && cycle.phase === PHASE.MINICUT) {
      reminders.push({ type: 'phase', icon: '🔄', text: 'New bulk cycle starts tomorrow' });
    }
  }

  if (state.algorithmState.frequencyMessage) {
    reminders.push({ type: 'info', icon: '🟢', text: state.algorithmState.frequencyMessage });
  }

  return reminders;
}
