#!/usr/bin/env node

/**
 * Multi-Seed Robustness Test for Masscience v2.4
 * 
 * Runs v2.4 simulation with 20 different random seeds and aggregates statistics
 * to verify that improvements are robust, not just lucky for seed 20260830
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run180DaySimulationV24 } from './v24-simulation.js';
// Note: v2.3 simulation not imported - focus on v2.4 robustness testing

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function round(n, decimals = 2) {
  return Math.round(n * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

async function runMultiSeedTest() {
  const seeds = [
    20260830, // Original test seed
    20260831, 20260832, 20260833, 20260834, 20260835,
    20260836, 20260837, 20260838, 20260839, 20260840,
    20260841, 20260842, 20260843, 20260844, 20260845,
    20260846, 20260847, 20260848, 20260849, 20260850,
  ];

  const results = {
    v24: [],
  };

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║   Masscience v2.4 Robustness Test (20 Seeds)                   ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    console.log(`Processing seed ${i + 1}/20: ${seed}`);

    // Run v2.4
    const v24Result = run180DaySimulationV24(seed);
    results.v24.push(v24Result.summary);

    console.log(`  ✓ Trend corr ${round(v24Result.summary.validation.trendWeightCorrelation, 4)}, MAE ${round(v24Result.summary.validation.trendWeightMAE, 3)} kg`);
    console.log(`  ✓ TDEE MAE ${round(v24Result.summary.validation.tdeeMAE, 1)} kcal, Bias ${round(v24Result.summary.validation.tdeeBias, 1)} kcal`);
    console.log(`  ✓ BF MAE ${round(v24Result.summary.validation.bodyFatMAE || 0, 2)} pp, Oscillations ${v24Result.summary.validation.oscillationCount || 0}\n`);
  }

  // ---- AGGREGATE STATISTICS ----
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║               v2.4 AGGREGATED RESULTS (20 Seeds)                ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Trend Correlation
  const v24TrendCor = results.v24.map(r => r.validation.trendWeightCorrelation);
  console.log('Trend Weight Correlation:');
  console.log(`  v2.4: mean=${round(v24TrendCor.reduce((a, b) => a + b) / v24TrendCor.length, 4)}, std=${round(calculateStdDev(v24TrendCor), 4)}`);
  console.log(`  (target > 0.90, min ${round(Math.min(...v24TrendCor), 4)}, max ${round(Math.max(...v24TrendCor), 4)})`);
  console.log();

  // Trend MAE
  const v24TrendMAE = results.v24.map(r => r.validation.trendWeightMAE);
  console.log('Trend Weight MAE (kg):');
  console.log(`  v2.4: mean=${round(v24TrendMAE.reduce((a, b) => a + b) / v24TrendMAE.length, 3)}, std=${round(calculateStdDev(v24TrendMAE), 3)}`);
  console.log(`  (target < 0.30, min ${round(Math.min(...v24TrendMAE), 3)}, max ${round(Math.max(...v24TrendMAE), 3)})`);
  console.log();

  // TDEE MAE
  const v24TDEEAE = results.v24.map(r => r.validation.tdeeMAE);
  console.log('TDEE MAE (kcal):');
  console.log(`  v2.4: mean=${round(v24TDEEAE.reduce((a, b) => a + b) / v24TDEEAE.length, 1)}, std=${round(calculateStdDev(v24TDEEAE), 1)}`);
  console.log(`  (target < 120, min ${round(Math.min(...v24TDEEAE), 1)}, max ${round(Math.max(...v24TDEEAE), 1)})`);
  console.log();

  // TDEE Bias
  const v24TDEEBias = results.v24.map(r => r.validation.tdeeBias);
  console.log('TDEE Bias (kcal):');
  console.log(`  v2.4: mean=${round(v24TDEEBias.reduce((a, b) => a + b) / v24TDEEBias.length, 1)}, std=${round(calculateStdDev(v24TDEEBias), 1)}`);
  console.log(`  (target ≈ 0, min ${round(Math.min(...v24TDEEBias), 1)}, max ${round(Math.max(...v24TDEEBias), 1)})`);
  console.log();

  // BF MAE
  const v24BFMAE = results.v24.map(r => r.validation.bodyFatMAE || 0);
  console.log('Body-Fat MAE (pp):');
  console.log(`  v2.4: mean=${round(v24BFMAE.reduce((a, b) => a + b) / v24BFMAE.length, 2)}, std=${round(calculateStdDev(v24BFMAE), 2)}`);
  console.log(`  (target < 0.75, min ${round(Math.min(...v24BFMAE), 2)}, max ${round(Math.max(...v24BFMAE), 2)})`);
  console.log();

  // Save full results
  const outputDir = path.join(__dirname, 'multi-seed-results');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outputDir, 'v24-summary.json'),
    JSON.stringify({
      timestamp: new Date().toISOString(),
      seeds,
      v24: results.v24,
      aggregated: {
        trendCorrelation: {
          v24: { mean: round(v24TrendCor.reduce((a, b) => a + b) / v24TrendCor.length, 4), std: round(calculateStdDev(v24TrendCor), 4) },
        },
        trendMAE: {
          v24: { mean: round(v24TrendMAE.reduce((a, b) => a + b) / v24TrendMAE.length, 3), std: round(calculateStdDev(v24TrendMAE), 3) },
        },
        tdeeMAE: {
          v24: { mean: round(v24TDEEAE.reduce((a, b) => a + b) / v24TDEEAE.length, 1), std: round(calculateStdDev(v24TDEEAE), 1) },
        },
        tdeeBias: {
          v24: { mean: round(v24TDEEBias.reduce((a, b) => a + b) / v24TDEEBias.length, 1), std: round(calculateStdDev(v24TDEEBias), 1) },
        },
        bfMAE: {
          v24: { mean: round(v24BFMAE.reduce((a, b) => a + b) / v24BFMAE.length, 2), std: round(calculateStdDev(v24BFMAE), 2) },
        },
      },
    }, null, 2)
  );

  console.log(`✓ Multi-seed results saved to: ${outputDir}/v24-summary.json\n`);
}

function calculateStdDev(values) {
  const mean = values.reduce((a, b) => a + b) / values.length;
  const variance = values.reduce((a, x) => a + (x - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

runMultiSeedTest().catch(console.error);
