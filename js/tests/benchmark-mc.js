/**
 * Monte Carlo convergence benchmark
 * Run: node js/tests/benchmark-mc.js
 */
import { PHASE, MONTE_CARLO } from '../constants.js';
import { calculateFFMI, recommendedGainRange } from '../calculations.js';
import {
  compositionFromBF, sampleMinicutPartition, sampleBulkPartition, applyPartition,
} from '../composition.js';
import { round, clamp, createRng } from '../utils.js';

const profile = { sex: 'male', heightCm: 178, weightKg: 75, bodyFatPercent: 14, trainingYears: 3 };

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

function runMc(n, seed = 42) {
  const rng = createRng(seed);
  const weights = []; const bfs = []; let exceed = 0;
  const rateMean = 0.2; const rateSE = 0.1; const remainingWeeks = 8;
  const currentWeight = 76; const currentBf = 15; const maxBf = 18;

  for (let i = 0; i < n; i++) {
    const rate = truncatedNormal(rng, rateMean, rateSE, rateMean - 3 * rateSE, rateMean + 3 * rateSE);
    const wChange = rate * remainingWeeks;
    const startBf = clamp(truncatedNormal(rng, currentBf, 2.5, 3, 50), 3, 50);
    const { fatMass, leanMass } = compositionFromBF(currentWeight, startBf);
    const p = sampleBulkPartition(rng, profile.trainingYears, startBf);
    const part = { fatChange: wChange * p.fat, leanChange: wChange * p.lean };
    const endWeight = currentWeight + wChange;
    const endBf = clamp(((fatMass + part.fatChange) / endWeight) * 100, 3, 50);
    weights.push(endWeight);
    bfs.push(endBf);
    if (endBf > maxBf) exceed++;
  }
  weights.sort((a, b) => a - b);
  bfs.sort((a, b) => a - b);
  const p = (arr, q) => arr[Math.floor(arr.length * q)];
  return {
    weightP50: round(p(weights, 0.5), 2),
    bfP50: round(p(bfs, 0.5), 2),
    pExceed: round(exceed / n, 3),
  };
}

const counts = [400, 800, 1000, 5000];
const results = counts.map(n => ({ n, ...runMc(n) }));
const ref = results.find(r => r.n === 5000);

console.log('\nMonte Carlo convergence benchmark\n');
console.log('N\tWeight P50\tBF P50\tP(exceed)\tΔ vs 5000');
results.forEach(r => {
  const dW = Math.abs(r.weightP50 - ref.weightP50);
  const dBf = Math.abs(r.bfP50 - ref.bfP50);
  const dP = Math.abs(r.pExceed - ref.pExceed);
  console.log(`${r.n}\t${r.weightP50}\t\t${r.bfP50}\t\t${(r.pExceed * 100).toFixed(1)}%\t\tW:${dW.toFixed(2)} BF:${dBf.toFixed(2)} P:${(dP * 100).toFixed(1)}pp`);
});
console.log(`\nConfigured default: ${MONTE_CARLO.SIMULATIONS} sims\n`);
