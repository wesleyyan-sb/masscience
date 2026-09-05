/**
 * Masscience v2.3 vs v2.4 Comparison Test Runner
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run180DaySimulation } from './simulated-user-scenario.js';
import { run180DaySimulationV24 } from './v24-simulation.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SEED = 20260830;

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║       Masscience v2.3 vs v2.4 Comparison Test                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('Running v2.3 baseline (seed ' + SEED + ')...');
  const result23Full = run180DaySimulation(SEED);
  const resultV23 = result23Full.summary;

  console.log('Running v2.4 improved (seed ' + SEED + ')...');
  const resultV24Full = run180DaySimulationV24(SEED);
  const resultV24 = resultV24Full.summary ? resultV24Full.summary : resultV24Full;

  // Extract key metrics
  const metricsV23 = extractMetrics(resultV23);
  const metricsV24 = extractMetrics(resultV24);

  // Display comparison table
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                       METRICS COMPARISON                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');

  displayComparisonTable([
    ['METRIC', 'v2.3', 'v2.4', 'IMPROVEMENT'],
    ['─', '─', '─', '─'],
    ['Trend Weight Correlation', metricsV23.trendCorr, metricsV24.trendCorr, compareNum(metricsV23.trendCorr, metricsV24.trendCorr, 'higher')],
    ['Trend Weight MAE (kg)', metricsV23.trendMAE, metricsV24.trendMAE, compareNum(metricsV23.trendMAE, metricsV24.trendMAE, 'lower')],
    ['Trend Weight RMSE (kg)', metricsV23.trendRMSE, metricsV24.trendRMSE, compareNum(metricsV23.trendRMSE, metricsV24.trendRMSE, 'lower')],
    ['Trend Weight Bias (kg)', metricsV23.trendBias, metricsV24.trendBias, compareNum(metricsV23.trendBias, metricsV24.trendBias, 'closer_to_zero')],
    ['', '', '', ''],
    ['TDEE MAE (kcal)', metricsV23.tdeeMAE, metricsV24.tdeeMAE, compareNum(metricsV23.tdeeMAE, metricsV24.tdeeMAE, 'lower')],
    ['TDEE Bias (kcal)', metricsV23.tdeeBias, metricsV24.tdeeBias, compareNum(metricsV23.tdeeBias, metricsV24.tdeeBias, 'closer_to_zero')],
    ['', '', '', ''],
    ['Body-Fat MAE (pp)', metricsV23.bfMAE, metricsV24.bfMAE, compareNum(metricsV23.bfMAE, metricsV24.bfMAE, 'lower')],
    ['Body-Fat Bias (pp)', metricsV23.bfBias, metricsV24.bfBias, compareNum(metricsV23.bfBias, metricsV24.bfBias, 'closer_to_zero')],
    ['', '', '', ''],
    ['Rate Integral Error (kg)', metricsV23.rateIntError, metricsV24.rateIntError, compareNum(metricsV23.rateIntError, metricsV24.rateIntError, 'lower')],
    ['Steady-State Rate Error (kg)', metricsV23.ssRateError, metricsV24.ssRateError, compareNum(metricsV23.ssRateError, metricsV24.ssRateError, 'lower')],
    ['', '', '', ''],
    ['Calorie Adjustments Count', metricsV23.adjCount, metricsV24.adjCount, ''],
    ['Calorie Adjustment Variance', metricsV23.adjVariance, metricsV24.adjVariance, compareNum(metricsV23.adjVariance, metricsV24.adjVariance, 'lower')],
    ['Maximum Calorie Adjustment', metricsV23.adjMax, metricsV24.adjMax, compareNum(metricsV23.adjMax, metricsV24.adjMax, 'lower')],
    ['Oscillation Count', metricsV23.oscCount, metricsV24.oscCount, compareNum(metricsV23.oscCount, metricsV24.oscCount, 'lower')],
  ]);

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                   BODY COMPOSITION SUMMARY                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');

  console.log('Initial State:');
  console.log(`  Weight: ${resultV23.groundTruth6ComponentBodyComposition.initialTruePhysiologicalWeight} kg`);
  console.log(`  Body Fat: ${resultV23.groundTruth6ComponentBodyComposition.initialTrueBodyFat}%`);
  console.log('');

  console.log('Final Ground Truth:');
  console.log(`  Weight: ${resultV23.groundTruth6ComponentBodyComposition.finalTruePhysiologicalWeight} kg`);
  console.log(`  Fat Mass: ${resultV23.groundTruth6ComponentBodyComposition.finalTrueFatMass} kg (change: ${resultV23.groundTruth6ComponentBodyComposition.trueFatMassChange} kg)`);
  console.log(`  Muscle Mass: ${resultV23.groundTruth6ComponentBodyComposition.finalTrueMuscleMass} kg (change: ${resultV23.groundTruth6ComponentBodyComposition.trueMuscleMassChange} kg)`);
  console.log(`  Body Fat: ${resultV23.groundTruth6ComponentBodyComposition.finalTrueBodyFat}% (change: ${resultV23.groundTruth6ComponentBodyComposition.trueBodyFatChange} pp)`);
  console.log('');

  console.log('v2.3 Estimated Final Body Fat: N/A (not tracked per snapshot)');
  console.log('v2.4 Estimated Final Body Fat: ' + (resultV24.weeklySnapshots ? resultV24.weeklySnapshots[resultV24.weeklySnapshots.length - 1].estimatedBfPercent : 'N/A') + '%');
  console.log('');

  // Save detailed results
  const outDir = path.join(__dirname, 'v24-results');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'v23-results.json'),
    JSON.stringify(result23Full, null, 2)
  );
  console.log(`✓ v2.3 results saved to: ${outDir}/v23-results.json`);

  fs.writeFileSync(
    path.join(outDir, 'v24-results.json'),
    JSON.stringify(resultV24Full, null, 2)
  );
  console.log(`✓ v2.4 results saved to: ${outDir}/v24-results.json`);

  // Summary
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                          SUMMARY                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const improvements = countImprovements(metricsV23, metricsV24);
  console.log(`v2.4 shows improvements in ${improvements} key metrics`);
  console.log('');

  if (resultV24.validation?.trendWeightCorrelation > 0.90 &&
      resultV24.validation?.trendWeightMAE < 0.30) {
    console.log('✓ v2.4 MEETS PRIMARY TARGETS:');
    console.log(`  - Trend correlation: ${resultV24.validation.trendWeightCorrelation} > 0.90 ✓`);
    console.log(`  - Trend MAE: ${resultV24.validation.trendWeightMAE} < 0.30 kg ✓`);
  } else {
    console.log('✗ v2.4 does not meet all primary targets:');
    if (resultV24.validation?.trendWeightCorrelation <= 0.90) {
      console.log(`  - Trend correlation: ${resultV24.validation.trendWeightCorrelation} (target > 0.90)`);
    }
    if (resultV24.validation?.trendWeightMAE >= 0.30) {
      console.log(`  - Trend MAE: ${resultV24.validation.trendWeightMAE} kg (target < 0.30 kg)`);
    }
  }

  console.log('');
}

function extractMetrics(result) {
  const val = result.validationMetrics || result.validation || {};
  return {
    trendCorr: (val.trendWeightCorrelation ?? 'N/A').toFixed ? val.trendWeightCorrelation.toFixed(4) : val.trendWeightCorrelation,
    trendMAE: (val.trendWeightMAE ?? 'N/A').toFixed ? val.trendWeightMAE.toFixed(3) : val.trendWeightMAE,
    trendRMSE: (val.trendWeightRMSE ?? 'N/A').toFixed ? val.trendWeightRMSE.toFixed(3) : val.trendWeightRMSE,
    trendBias: (val.trendWeightBias ?? 'N/A').toFixed ? val.trendWeightBias.toFixed(3) : val.trendWeightBias,
    tdeeMAE: (val.tdeeMAE ?? 'N/A').toFixed ? val.tdeeMAE.toFixed(1) : val.tdeeMAE,
    tdeeBias: (val.tdeeBias ?? 'N/A').toFixed ? val.tdeeBias.toFixed(1) : val.tdeeBias,
    bfMAE: (val.bodyFatMAE ?? 'N/A').toFixed ? val.bodyFatMAE.toFixed(2) : val.bodyFatMAE,
    bfBias: (val.bodyFatBias ?? 'N/A').toFixed ? val.bodyFatBias.toFixed(2) : val.bodyFatBias,
    rateIntError: (val.integralAbsoluteRateError ?? 'N/A').toFixed ? val.integralAbsoluteRateError.toFixed(2) : val.integralAbsoluteRateError,
    ssRateError: (val.steadyStateRateError ?? 'N/A').toFixed ? val.steadyStateRateError.toFixed(3) : val.steadyStateRateError,
    adjCount: val.totalCalorieAdjustments ?? 'N/A',
    adjVariance: (val.calorieAdjustmentVariance ?? 'N/A').toFixed ? val.calorieAdjustmentVariance.toFixed(1) : val.calorieAdjustmentVariance,
    adjMax: val.maximumCalorieAdjustment ?? 'N/A',
    oscCount: val.oscillationCount ?? 'N/A',
  };
}

function compareNum(v23, v24, direction) {
  if (v23 === 'N/A' || v24 === 'N/A') return '─';
  const v23Num = Number(v23);
  const v24Num = Number(v24);
  if (isNaN(v23Num) || isNaN(v24Num)) return '─';

  let improved = false;
  if (direction === 'higher') improved = v24Num > v23Num;
  else if (direction === 'lower') improved = v24Num < v23Num;
  else if (direction === 'closer_to_zero') improved = Math.abs(v24Num) < Math.abs(v23Num);

  if (improved) {
    const pct = Math.abs(((v24Num - v23Num) / v23Num) * 100).toFixed(1);
    return `↑ ${pct}%`;
  } else if (v24Num === v23Num) {
    return '─';
  } else {
    const pct = Math.abs(((v24Num - v23Num) / v23Num) * 100).toFixed(1);
    return `↓ ${pct}%`;
  }
}

function displayComparisonTable(rows) {
  const colWidths = [35, 14, 14, 18];
  for (const row of rows) {
    const formatted = row.map((cell, i) => String(cell).padEnd(colWidths[i])).join(' │ ');
    if (row[0].startsWith('─')) {
      console.log('  ├─' + row.map((_, i) => '─'.repeat(colWidths[i])).join('─┼─') + '─┤');
    } else {
      console.log('  │ ' + formatted + ' │');
    }
  }
}

function countImprovements(v23, v24) {
  let count = 0;
  if (Number(v24.trendCorr) > Number(v23.trendCorr)) count++;
  if (Number(v24.trendMAE) < Number(v23.trendMAE)) count++;
  if (Number(v24.tdeeMAE) < Number(v23.tdeeMAE)) count++;
  if (Math.abs(Number(v24.tdeeBias)) < Math.abs(Number(v23.tdeeBias))) count++;
  if (Number(v24.bfMAE) < Number(v23.bfMAE)) count++;
  if (Number(v24.rateIntError) < Number(v23.rateIntError)) count++;
  return count;
}

main().catch(console.error);
