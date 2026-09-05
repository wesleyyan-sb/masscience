# Masscience v2.4 — Information-Flow Audit
## CRITICAL FINDINGS: Ground Truth Leakage to State Estimator

**Date**: 2026-08-30  
**Status**: 🚨 CRITICAL ISSUE IDENTIFIED  
**Severity**: BLOCKS PRODUCTION DEPLOYMENT

---

## Executive Summary

v2.4 simulation contains **systematic leakage of ground-truth information** into the state estimation and control loops. The state estimator receives perfect information about true TDEE, which it should not have access to in real deployment.

This explains why:
- Trend correlation is so high (0.9942) — estimator has perfect energy balance information
- BF estimation still fails — even with perfect EB, tissue partition is uncertain
- Controller performance is excellent — it's not actually learning TDEE, it's receiving it

**Conclusion**: v2.4 metrics are misleading. Real-world deployment would have much worse performance.

---

## Part 1: Complete Information-Flow Audit

### Ground Truth Simulation (Should NOT affect estimator)

```
Day Loop:
├─ Calculate true TDEE from physics
│  ├─ BMR (Mifflin-St Jeor)
│  ├─ Activity energy (1.55x)
│  ├─ TEF (7-12%)
│  ├─ Lean mass cost
│  └─ Adaptive thermogenesis
│
├─ True energy balance = Intake - True TDEE
│
├─ Energy partitioning (6-compartment physics)
│  ├─ Fat gain/loss
│  ├─ Muscle gain/loss
│  ├─ Glycogen dynamics
│  ├─ Water dynamics
│  ├─ Digestive content
│  └─ Other lean tissue
│
└─ Generate noisy observations
   └─ Weekly weigh-in + noise
```

### State Estimator (Should ONLY see observations)

```
Weekly Estimation Loop:
├─ INPUT: Observed trend weight (with noise)
├─ INPUT: Calorie intake (known from tracking)
├─ INPUT: Trend quality metrics
│
├─ Estimate tissue weight (Kalman filter)
│  ├─ Uses: trend weight
│  ├─ Uses: energy balance ⚠️ PROBLEM HERE
│  ├─ Uses: phase information
│  └─ Uses: confidence
│
├─ Estimate body fat %
│  ├─ Uses: tissue weight changes
│  ├─ Uses: P-ratio model
│  └─ Uses: confidence
│
├─ Estimate TDEE
│  ├─ Uses: trend weight change
│  ├─ Uses: calorie intake
│  └─ Tries to infer from these
│
└─ OUTPUT: State estimates + confidence
```

### Controller (Should ONLY see estimates)

```
Weekly Control Loop:
├─ INPUT: Estimated tissue rate (from estimator)
├─ INPUT: Target rate (phase-dependent)
├─ INPUT: Confidence score
│
├─ Calculate error = estimated_rate - target_rate
├─ PI controller adjustment
└─ OUTPUT: New calorie recommendation
```

---

## Part 2: The Information Leak

### CRITICAL LEAK: Energy Balance Calculation

**Location**: `js/tests/v24-simulation.js`, line 287

```javascript
const trueTDEE = Number(
  (bmrToday + activityKcal + tefKcal + leanMassCost + adaptiveTDEE_gt + tdeeBaseVariance).toFixed(1)
);
const trueEnergyIntakeKcal = currentCalories;
const ebKcal = trueEnergyIntakeKcal - trueTDEE;  // ⚠️ GROUND TRUTH
```

**Then passed to estimator**:

```javascript
const newTissueWeight = updateTissueWeight(
  estimatedTissueWeight,
  trendWt,
  ebKcal / 7,  // ⚠️ PERFECT ENERGY BALANCE PASSED TO ESTIMATOR
  daysInCurrentPhase,
  currentPhase,
  trendData.confidence ?? 50
);
```

### Why This Is Critical

The state estimator receives `ebKcal / 7` (daily energy balance), which is:
- ✅ True energy intake (calorie tracking - observable)
- ❌ True TDEE (ground truth - NOT observable)
- ❌ Therefore energy balance (LEAKED INFORMATION)

**In real deployment**, the estimator would NOT have `ebKcal`. Instead, it would need to:
1. Estimate TDEE from historical weight changes
2. Infer energy balance indirectly
3. Deal with significant uncertainty

### Information Leakage Cascade

```
True TDEE (ground truth)
    ↓
Perfect energy balance (ebKcal)
    ↓
Perfect tissue weight estimation
    ↓
Tissue weight → Tissue rate (very clean signal)
    ↓
Controller receives clean tissue rate feedback
    ↓
Controller learns easily, produces low error
    ↓
Trend correlation 0.9942 ✓ (but artificial!)
```

**Without leak**, the chain would be:

```
Observed trend weight (noisy)
    ↓
Estimate tissue weight (with uncertainty)
    ↓
Estimate TDEE from tissue changes (with error)
    ↓
Use estimated EB (with error) for tissue estimation
    ↓
Circular dependency, more uncertainty
    ↓
Controller receives noisy tissue rate
    ↓
Controller learns slower, produces higher error
    ↓
Trend correlation would be ~0.90-0.93 (more realistic)
```

---

## Part 3: Other Information Leaks

### LEAK #2: Ideal Phase Transitions

**Location**: Phase is determined by schedule, not controller

```javascript
const phaseTransitionTracker = 
  shouldTransitionPhase(
    schedule,           // Predetermined schedule
    currentPhaseIndex,
    daysInCurrentPhase
  );
```

In production, phase transitions would need to be:
- Inferred from weight/performance trends
- Adjusted based on controller decisions
- Not predetermined

**Current method**: Controller receives perfect information about when phase changes occur.

### LEAK #3: Observation Noise

The noise added to observations is:

```javascript
const observationNoise = nextNormal(0, 0.05); // ±50g 1σ
```

This is:
- ✓ Realistic for home scale
- ✓ Properly simulated
- ✓ Not a leak per se

But combined with leak #1, the estimator can filter this out because it has perfect EB.

### LEAK #4: Physiological Constants

The estimator uses:

```javascript
const KCAL_PER_KG_TISSUE = 7700;  // Hardcoded
```

This assumes:
- Perfect knowledge of tissue composition
- No person-specific variation
- No adaptive changes

Real deployment should estimate this from historical data.

---

## Part 4: Impact on Metrics

### Why BF MAE is High (3.27 pp) Despite Perfect EB Input

Even with perfect energy balance, BF estimation is poor because:

1. **BF requires partitioning assumption**: `fat_change = tissue_change * p_ratio`
2. **P-ratio is person-specific**: Model uses training-age estimate
3. **Real individuals vary widely**: ±10% deviation is common
4. **Model can't distinguish**:
   - Water changes vs fat changes
   - Muscle vs other lean mass
   - Adaptive thermogenesis effects

**Evidence**: The estimator can perfectly track tissue weight (0.9942 corr) but fails at fat partition (3.27 pp MAE).

This suggests:
- Tissue weight estimation is artificially accurate (leaked EB)
- Fat partition is genuinely uncertain (no information available)

### What Real TDEE Performance Would Be

Without perfect energy balance input, `updateTDEEEstimate()` would:

1. Receive noisy tissue weight signal
2. Try to infer TDEE from tissue changes
3. But tissue changes also depend on water/glycogen
4. Result: High uncertainty TDEE estimates

**Predicted real MAE**: 400-600 kcal (vs current 229 kcal)

---

## Part 5: Severity Classification

| Issue | Severity | Impact |
|-------|----------|--------|
| Perfect EB input to estimator | 🚨 CRITICAL | Trend correlation artificially high |
| Predetermined phase schedule | 🔴 HIGH | Controller doesn't really adapt phases |
| Hardcoded physiological constants | 🟡 MEDIUM | Limits personalization |
| Observation noise level | 🟢 LOW | Properly simulated |

---

## Part 6: Required Fixes

### Fix #1: Remove EB from State Estimator (MUST DO)

**Current** (WRONG):
```javascript
const newTissueWeight = updateTissueWeight(
  estimatedTissueWeight,
  trendWt,
  ebKcal / 7,           // ⚠️ GROUND TRUTH
  ...
);
```

**Corrected** (REAL):
```javascript
const newTissueWeight = updateTissueWeight(
  estimatedTissueWeight,
  trendWt,
  // ebKcal NOT provided
  // Tissue weight estimated purely from:
  // 1. Trend weight observations
  // 2. Historical tissue rate
  // 3. Confidence in trend quality
  ...
);
```

The estimator should infer tissue changes only from:
- Observed trend weight movement
- Kalman filtering (observation + model blend)
- Historical rate patterns

### Fix #2: Implement Real TDEE Estimation

**Current** (WRONG):
```javascript
const tdeeErrors = weeklySnapshots.map(
  s => s.estimatedTDEE - s.groundTruth.trueTDEEKcal
);
```

The estimator tries to estimate TDEE, but the tissue weight input is artificially clean (from perfect EB).

**Corrected** (REAL):
```javascript
// TDEE estimation should work harder
// Use: weight trend changes over time
// Use: historical EB patterns
// Use: controller adjustment history
// But NOT direct EB (which requires true TDEE)
```

### Fix #3: Controller-Driven Phase Management

**Current** (WRONG):
```javascript
if (shouldTransitionPhase(schedule, currentPhaseIndex, daysInCurrentPhase)) {
  // Phase change predetermined by schedule
  currentPhase = schedule[currentPhaseIndex + 1].phase;
}
```

**Corrected** (REAL):
```javascript
// Phase transition should be:
// 1. Suggested by controller based on progress
// 2. Confirmed by user intent
// 3. Not predetermined by schedule
```

---

## Part 7: Action Items

### IMMEDIATE (Blocking Production)

- [ ] Create `v24-simulation-corrected.js` without ground-truth leaks
- [ ] Remove `ebKcal` input from `updateTissueWeight()`
- [ ] Re-run metrics on corrected simulation
- [ ] Document expected metric degradation
- [ ] Implement real TDEE estimation from observations only

### HIGH PRIORITY

- [ ] Fix phase transition logic (controller-driven, not predetermined)
- [ ] Add alternative tissue estimation (Kalman without EB)
- [ ] Validate that corrected version still converges

### MEDIUM PRIORITY

- [ ] Personalize physiological constants (learn from historical data)
- [ ] Add explicit TDEE measurement capability (for testing)
- [ ] Implement uncertainty bounds around estimates

---

## Part 8: Expected Metrics After Fixes

**With fixes applied**, realistic metrics would likely be:

| Metric | Current (LEAKED) | Expected (REAL) | Target |
|--------|------------------|-----------------|--------|
| Trend Correlation | 0.9942 | 0.90-0.93 | > 0.90 |
| Trend MAE | 0.290 kg | 0.35-0.40 kg | < 0.30 |
| TDEE MAE | 229 kcal | 400-600 kcal | < 120 |
| TDEE Bias | 23.4 kcal | 50-100 kcal | ≈ 0 |
| BF MAE | 3.27 pp | 3.50-4.00 pp | < 0.75 |

**Conclusion**: Removing the leak will degrade metrics, but will produce a more honest assessment of real-world viability.

---

## Part 9: Recommendation

**DO NOT PROCEED WITH v2.4.2 DEPLOYMENT**

The current metrics are misleading due to ground-truth information leakage. Before declaring any version production-ready:

1. ✅ Remove all ground-truth inputs from state estimator
2. ✅ Implement observation-only TDEE and tissue estimation
3. ✅ Re-validate metrics with corrected simulation
4. ✅ Accept that real-world performance will be lower
5. ✅ Then decide based on HONEST metrics whether to proceed

The fact that BF estimation remains poor (3.27 pp) even with perfect EB input suggests the model has fundamental identifiability limitations that leaking perfect EB cannot solve.

---

**Report Status**: CRITICAL ISSUE IDENTIFIED - DEPLOYMENT BLOCKED

**Next Phase**: v2.4.3 Corrected Implementation with Honest Metrics

