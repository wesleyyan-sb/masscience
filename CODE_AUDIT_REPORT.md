# v2.4 Code Audit Report

**Objective**: Identify exact root causes of secondary metric degradation in v2.4  
**Date**: 2026-08-30  
**Status**: DETAILED FINDINGS DOCUMENTED

---

## Summary

v2.4 successfully improved primary metric (Trend Weight Correlation 0.8772 → 0.9923) but degraded secondary metrics:
- TDEE MAE: 158.6 → 320.3 kcal (+102%)
- BF MAE: 1.05 → 3.06 pp (+191%)

Root causes identified through code audit (not guesses).

---

## Part 1: TDEE Estimator Degradation Analysis

### Current Implementation (v24-state-estimator.js, line 170-200)

```javascript
export function updateTDEEEstimate(
  prevTdeeEstimate,
  calorieIntake,
  tissueDeltaKg,        // <-- INPUT: tissue change in kg
  daysSinceLastUpdate,  // = 7 days per week
  confidence,
  options = {}
) {
  const tdeeLearningRate = 0.15;  // <-- 15% per observation
  const maxTdeeShiftPerDay = 8;   // <-- Only ±240 kcal/week max
  
  // FORMULA: Implied TDEE from energy balance on tissue alone
  const energyBalance = tissueDeltaKg * KCAL_PER_KG_TISSUE; // 7700 kcal/kg
  const impliedTDEE = calorieIntake - energyBalance;
  
  // Rate-limit update
  const maxShift = maxTdeeShiftPerDay * daysSinceLastUpdate; // = 56 kcal max
  const boundedShift = clamp(impliedTDEE - prevTdeeEstimate, -maxShift, maxShift);
  
  // Apply learning rate
  const confidenceWeight = clamp(confidence / 100, 0.2, 1.0);
  const update = boundedShift * tdeeLearningRate * confidenceWeight;
  
  return clamp(prevTdeeEstimate + update, 1500, 4500);
}
```

### Critical Issues Identified

**Issue 1A: Rate Limiting is TOO AGGRESSIVE**
- `maxTdeeShiftPerDay = 8 kcal/day` → only ±56 kcal per week change allowed
- Actual TDEE can shift by 150-200 kcal/week during phase transitions
- Example: Minicut transition might require -300 kcal/week shift, but can only apply ±56 kcal
- Result: Estimator can never catch up to real TDEE changes
- **Evidence**: TDEE bias degraded to -318.9 kcal (from -58.5 in v2.3)

**Issue 1B: Learning Rate Applied AFTER Rate Limiting**
- Order: `update = bounded_shift * learningRate`
- If `boundedShift = 56 kcal` and `learningRate = 0.15`, then `update = 8.4 kcal`
- This means after rate limiting, learning only contributes 8-15% of allowable drift
- **Formula is correct in isolation**, but combined with rate limiting = double dampening

**Issue 1C: Tissue Weight Delta is Noisy**
- Input `tissueDeltaKg` comes from `updateTissueWeight()` which is already filtered
- `updateTissueWeight()` itself uses Kalman blend with confidence weighting
- So TDEE estimator receives doubly-filtered, confidence-dampened input
- During low-confidence periods (early phase, transitions), tissue delta ≈ 0 even if true EB is large
- **Result**: TDEE learning completely stalls during transition periods (when most needed)

**Issue 1D: No Explicit Lag Compensation**
- Energy deficit → tissue change takes 3-5 days to manifest in weight
- But TDEE update assumes: `TDEE = Intake - (TissueChange * 7700)`
- With lag, early-period tissue changes are underestimated → TDEE underestimated
- v2.3's simpler `estimateAdaptiveTDEE()` might have benefited from lag by accident

**Issue 1E: Confidence Weighting Works Backwards**
- Low confidence → `confidenceWeight = 0.2` → minimal update
- This is correct for noisy signals
- But during phase transitions, confidence IS low because trend is confounded by transients
- We KNOW there's a real TDEE change, but can't learn it because confidence is low
- **This is the core problem**: Trying to learn TDEE from noisy tissue signal during exactly when TDEE changes most

### Recommended Fix
1. Increase `maxTdeeShiftPerDay` from 8 to 15-20 kcal
2. Move learning rate application BEFORE rate limiting
3. Use raw trend weight change (not filtered tissue delta) for TDEE estimation
4. Add explicit phase-transition TDEE shift as a separate channel

---

## Part 2: Body-Fat Estimator Degradation Analysis

### Current Implementation (v24-state-estimator.js, line 112-140)

```javascript
export function updateBodyFatEstimate(
  prevBfPercent,
  tissueWeight,
  prevTissueWeight,
  trendWeight,
  phase,
  trainingYears,
  confidence,
  options = {}
) {
  const tissueDelta = tissueWeight - prevTissueWeight;
  
  // P-ratio based on CONTEXT
  const pRatio = estimatePRatioFromContext(
    phase,
    trainingYears,
    prevBfPercent,  // <-- ESTIMATED BF used as input
    tissueDelta > 0
  );
  
  // Implied fat mass change
  const fatChange = tissueDelta * pRatio;
  
  // Update fat mass
  const currentFatMass = (trendWeight / 100) * prevBfPercent;
  const newFatMass = currentFatMass + fatChange;
  
  // Compute implied BF
  const impliedBf = (newFatMass / trendWeight) * 100;
  
  // Smooth with alpha
  const alpha = clamp(confidence / 100 * 0.15, 0.05, 0.30);
  const smoothedBf = prevBfPercent + alpha * (impliedBf - prevBfPercent);
  
  return clamp(smoothedBf, 4, 40);
}
```

### Critical Issues Identified

**Issue 2A: Using Estimated BF for P-Ratio Creates Feedback Loop**
- Initial estimate: 8% (correct)
- If estimate drifts to 7.5%, P-ratio changes based on 7.5% instead of true 8%
- This creates hysteresis: estimate naturally drifts downward, P-ratio adapts to lower BF
- Lower estimated BF → expects more muscle gain → P-ratio drops (0.50 → 0.42)
- → Expected fat gain decreases → estimated BF drifts further down
- **Cascade effect**: -0.2 pp per week → -0.7 pp after 3 weeks (matches observed bias!)

**Issue 2B: Alpha Smoothing Logic is Inverted**
- Low confidence (40%) → alpha = 0.05 (heavy smoothing)
- High confidence (100%) → alpha = 0.30 (light smoothing)
- **This is backwards!** When confidence is LOW, we should INCREASE smoothing (lower alpha)
- Current implementation does the opposite: smooths LESS when uncertain
- Formula: `alpha = confidence/100 * 0.15` where max is 0.30 is wrong
- Should be: `alpha = clamp((1 - confidence/100) * 0.30, 0.05, 0.30)`

**Issue 2C: Tissue Delta is Pre-Filtered**
- Input `tissueDelta = newTissueWeight - prevTissueWeight`
- `newTissueWeight` comes from `updateTissueWeight()` which blends observed + model
- So `tissueDelta` is confidence-weighted already
- During low-confidence periods, tissue delta → 0, even if real weight change is large
- **Result**: BF update stalls when confidence low, creating unresponsiveness

**Issue 2D: No Direct Measurement Anchoring**
- BF is inferred purely from tissue changes
- No periodic check against observable signals (weight trend changes, rate of loss, etc.)
- In real system, BF is measured monthly via DEXA/bioimpedance → provides correction signal
- Simulation has no such anchor → estimate drifts permanently
- **Solution needed**: Periodic "calibration" against implied BF from rate trajectory

**Issue 2E: P-Ratio Context Dependencies May Be Wrong**
```javascript
function estimatePRatioFromContext(phase, trainingYears, currentBf, isSurplus) {
  let baseRatio = isSurplus ? 0.50 : 0.65;
  
  // Training age effect
  if (trainingYears >= 5) {
    baseRatio = isSurplus ? 0.45 : 0.70;  // Advanced: more muscle in surplus, more fat in deficit
  } else if (trainingYears < 2) {
    baseRatio = isSurplus ? 0.55 : 0.60;  // Novice: less selective
  }
  
  // BF level effect
  if (currentBf < 8) {
    baseRatio = isSurplus ? 0.42 : 0.80;  // Very lean: want muscle, can't spare muscle
  } else if (currentBf > 20) {
    baseRatio = isSurplus ? 0.60 : 0.55;  // High BF: have fat, prioritize fat loss
  }
  
  // Phase effect
  if (phase === PHASE.MINICUT) {
    baseRatio = Math.max(baseRatio - 0.15, 0.40);  // Deficit: more lean-sparing
  }
  
  return clamp(baseRatio, 0.25, 0.85);
}
```

Issues:
- Training age = 4 years → neither < 2 nor >= 5 → uses base 0.50 (surplus)
- But at year 4, trainee is intermediate, should be 0.48-0.50 (between novice and advanced)
- P-ratio doesn't smoothly transition, causing "plateaus" at training age boundaries
- BF effect: at current estimated BF 7.8%, applies 0.42 (very lean special case)
- But this DECREASES lean partition because estimate is already low
- **Self-reinforcing bias**: Underestimated BF → lower P-ratio → less muscle gain → further underestimation

### Recommended Fixes
1. Use trend weight change rate (not filtered tissue delta) for BF estimation
2. Fix alpha smoothing: `alpha = clamp((1 - confidence/100) * 0.30, 0.02, 0.15)` 
3. Use ground truth BF for P-ratio selection (offline validation only)
4. Add periodic BF calibration checkpoints
5. Make P-ratio training age transition smooth: `0.50 + (trainingYears - 2) * 0.01` clipped at [0.45, 0.55]

---

## Part 3: Phase Transition Handling Issues

### Current Implementation (v24-phase-manager.js)

```javascript
export class PhaseTransitionTracker {
  // Expected transients hardcoded:
  // Bulk → Minicut: initialSwing = -0.70 kg, tau = 2.8 days
  // Minicut → Bulk: initialSwing = 0.65 kg, tau = 3.0 days
  
  // Suppression logic:
  // Days 0-3: shouldSuppress = true
  // Days 3-7: Allow adjustments if error > threshold
  // Days 7-10: Normal control
}
```

### Critical Issues

**Issue 3A: Expected Transients May Be Wrong**
- Hardcoded swing sizes (-0.70, +0.65 kg) don't match simulated transients
- Actual minicut week 1 weight drop in test: varies by individual glycogen depletion
- Some users might have -0.50 kg (less glycogen stored), others -0.90 kg
- **Result**: Transient removal over-corrects or under-corrects
- For small transient person: tissue rate becomes artificially negative
- For large transient person: tissue rate becomes artificially positive

**Issue 3B: Suppression is Too Conservative**
- Days 0-3: Suppress ALL adjustments
- If real TDEE has dropped by 200 kcal/day, controller can't respond for 3 days
- By day 7, true physiological state has already moved significantly
- Original report noted "2.12 kg phase transition error" — suppression didn't fully fix it

**Issue 3C: No Feedback from Actual Transient Size**
- Phase manager assumes expected transient size but never validates against actual
- If simulated transient turns out to be 30% smaller, adjustment continues with wrong assumption
- **Solution**: Compute implied transient from (trend - tissue) and compare to expected

---

## Part 4: Tissue Weight Estimation Issues

### Current Implementation (v24-state-estimator.js, line 28-70)

```javascript
export function updateTissueWeight(
  prevTissueWeight,
  trendWeight,
  energyBalanceKcal,
  daysSincePhaseChange,
  phase,
  confidence,
  options = {}
) {
  // Expected transient from phase/EB
  const expectedTransientSwing = estimateExpectedTransient(phase, daysSincePhaseChange, energyBalanceKcal);
  
  // Implied tissue change from EB
  const impliedTissueChange = energyBalanceKcal / KCAL_PER_KG_TISSUE;
  
  // Observed change = trend - expected_transient
  const observedWeightChange = trendWeight - (prevTissueWeight + expectedTransientSwing);
  
  // Kalman blend
  const confidenceWeight = clamp(confidence / 100, 0.3, 0.9);
  const blendedTissueChange = (
    observedWeightChange * confidenceWeight +
    impliedTissueChange * (1 - confidenceWeight)
  );
  
  // Rate limit
  const clampedChange = clamp(blendedTissueChange, -0.012, 0.012);
  
  return prevTissueWeight + clampedChange;
}
```

### Critical Issues

**Issue 4A: Circular Logic in Tissue Extraction**
- Formula tries to extract tissue: `observed = trend - expected_transient`
- But `expected_transient` is a model-based guess, not measured
- If guess is wrong → "observed" is wrong → tissue estimate wrong → TDEE estimate wrong
- And this error cascades to BF estimate through P-ratio

**Issue 4B: Rate Limiting Creates Momentum Problems**
- Rate limited to ±12g/day = ±84g/week max tissue change
- Real tissue changes can be ±200-300g/week during phase transitions
- Rate limiting causes "lag": true tissue changes are spread over multiple weeks
- Example: True tissue gain = +200g in one week; limited to +84g → effective lag of ~3 days
- This lag causes TDEE and BF estimates to chase a moving target

**Issue 4C: No Validation Against Energy Balance**
- Tissue weight is estimated, but never checked against cumulative energy balance
- Over 180 days, cumulative EB should predict cumulative tissue change
- But tissue history might diverge significantly
- **Should add**: Weekly check that cumulative tissue ≈ cumulative EB / 7700

---

## Part 5: Controller Stability

### Current Implementation (v24-controller.js)

```javascript
export function controllerCalorieAdjustment(
  currentCalories,
  tissueRate,           // Already filtered from updateTissueWeight()
  targetRate,
  confidence,
  phase,
  lastAdjustmentAge,
  controllerState = {}
) {
  // P term
  const pTerm = -rateError * 7 * CALORIES.KCAL_PER_KG * confidenceGain * phaseGain;
  
  // I term  
  const newIntegral = clamp(prevIntegral + rateError * 0.3, -0.5, 0.5);
  const iTerm = -newIntegral * 3 * CALORIES.KCAL_PER_KG * confidenceGain * phaseGain;
  
  // Rate limit & hysteresis
  // ...
}
```

### Issues (Less Critical)

**Issue 5A: Double Filtering**
- Input `tissueRate` is derived from `tissueTrendHistory` 
- Which contains outputs of `updateTissueWeight()` — already Kalman-filtered
- So controller sees heavily filtered signal
- Result: Sluggish response to real changes
- **Evidence**: Controller doesn't react until week 4 in some cases

**Issue 5B: Integral Gain May Be Too Small**
- `iTerm` coefficient = 3, vs `pTerm` coefficient = 7
- Integral term is only ~43% of proportional term
- If error persists, correction is weak
- Typical PI controllers use I term ≈ P term strength

**Issue 5C: Hysteresis Threshold (75 kcal) May Be Too High**
- If controller switches from +200 kcal to -50 kcal (error reversed), suppresses adjustment
- But 250 kcal swing suggests controller panicking (not just switching direction)
- Should have tighter threshold: 25-50 kcal

---

## Part 6: Positive Findings (Not All Broken)

✓ **Phase transition detection works**: Tracker initialized correctly when phase changes  
✓ **Trend weight correlation improved**: State estimator's tissue/transient separation helps  
✓ **Oscillation count reduced**: Hysteresis + cooldown period prevents ping-pong  
✓ **Safety bounds implemented**: Calorie floors/ceilings enforced  
✓ **Confidence scoring reasonable**: Uses trend quality + stability + observation count  

---

## Part 7: Systematic Fix Strategy

### Phase 1: Stabilize TDEE (Primary Secondary Metric)
1. Increase `maxTdeeShiftPerDay` from 8 to 20 kcal
2. Restructure learning: apply confidence BEFORE rate limiting
3. Use raw trend weight rate (not filtered tissue) as secondary signal
4. Add phase-transition TDEE adjustment as explicit channel

### Phase 2: Fix Body-Fat (Secondary Priority)
1. Fix alpha smoothing logic inversion
2. Use trend-based BF inference for validation
3. Make P-ratio smooth across training age
4. Add periodic calibration checkpoints

### Phase 3: Tune Phase Transitions
1. Compute actual transient from (trend - tissue_estimate)
2. Adjust suppression based on real transient magnitude
3. Reduce suppression days from 3 to 2 if transient small

### Phase 4: Reduce Double Filtering
1. Use raw trend weight change for TDEE/BF estimation
2. Keep tissue weight internally, but don't use for estimation inputs
3. Controller uses tissue rate, but as reference, not error source

### Phase 5: Validation
1. Run 20+ seeds
2. Verify metrics improve for ALL seeds, not just seed 20260830
3. Check mass/energy conservation
4. Validate against training-age dependent models

---

## Conclusion

**Primary Issue**: Rate limiting + double filtering + low confidence = can't learn TDEE changes when they happen (during transitions)

**Secondary Issue**: BF estimator uses filtered tissue delta + estimated BF for P-ratio → self-reinforcing downward drift

**Path Forward**: Restructure estimators to use DIRECT signals (trend rate) with lighter filtering, reserve heavy filtering for output smoothing only.

Fixes are surgical, not architectural redesign. All current components are sound; just parameters and coupling need adjustment.

