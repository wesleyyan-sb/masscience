/**
 * Masscience V2 — Target trajectory & error computation
 */
import { round, daysBetween } from './utils.js';

export function calculateTargetTrajectory(startWeightKg, startDate, targetRateKgPerWeek, numDays) {
  const ratePerDay = targetRateKgPerWeek / 7;
  const trajectory = [];
  for (let d = 0; d <= numDays; d++) {
    trajectory.push({
      dayIndex: d,
      date: null,
      weight: startWeightKg + ratePerDay * d,
    });
  }
  return trajectory;
}

export function targetWeightAtDay(startWeightKg, targetRateKgPerWeek, dayIndex) {
  return startWeightKg + (targetRateKgPerWeek / 7) * dayIndex;
}

export function calculateTrajectoryError(trendData, startWeightKg, targetRateKgPerWeek, startDate) {
  if (!trendData?.latest) {
    return { errorKg: null, errorPercent: null, projectedEndWeight: null, distanceFromUpperBound: null };
  }

  const dayIndex = trendData.latest.dayIndex ?? 0;
  const actualTrend = trendData.latest.trend;
  const targetNow = targetWeightAtDay(startWeightKg, targetRateKgPerWeek, dayIndex);
  const errorKg = actualTrend - targetNow;
  const errorPercent = startWeightKg > 0 ? (errorKg / startWeightKg) * 100 : 0;

  const rate = trendData.rate?.perWeek ?? targetRateKgPerWeek;
  const remainingDays = Math.max(0, (trendData.phaseDaysRemaining ?? 0));
  const projectedEndWeight = actualTrend + (rate / 7) * remainingDays;

  return {
    errorKg: round(errorKg, 2),
    errorPercent: round(errorPercent, 2),
    targetNow: round(targetNow, 2),
    actualNow: round(actualTrend, 2),
    projectedEndWeight: round(projectedEndWeight, 2),
    dayIndex,
  };
}

export function compareRates(actualRate, targetRate, deadband) {
  const error = actualRate - targetRate;
  return {
    error,
    absError: Math.abs(error),
    withinDeadband: Math.abs(error) <= deadband,
  };
}
