# Masscience Architecture & Algorithm Documentation

**Algorithm Version:** `2.1.0`  
**Application Version:** `1.0.0`  
**Supersedes:** V2.0.0 (see [ALGORITHM_CHANGELOG.md](ALGORITHM_CHANGELOG.md))

This document is the authoritative mathematical specification. Code must match this document.

---

## 1. Architecture Overview

Masscience is a **client-side feedback-control system** for bodyweight trajectory management during lean bulk / minicut cycles.

```
User Input (onboarding, weigh-ins, body checks)
        ↓
State Management (js/storage.js, app.js)
        ↓
Initial Calculations (js/calculations.js)
        ↓
Weight Measurements (js/cycle.js)
        ↓
Outlier Detection (js/trend.js → detectOutlier)
        ↓
Trend Engine (js/trend.js → processWeightData)
        ↓
Rate-of-Change (js/trend.js → calculateRateOfGain)
        ↓
Target Trajectory & Error (js/trajectory.js)
        ↓
Confidence (js/confidence.js)
        ↓
Adaptive TDEE (js/adaptive.js → estimateAdaptiveTDEE)
        ↓
┌───────────────────────────────┬───────────────────────────────┐
│ CONTROL (weight only)         │ COMPOSITION (informational)   │
│ js/control.js                 │ js/composition.js             │
│ calculateCalorieAdjustment    │ estimateBodyComposition       │
└───────────────────────────────┴───────────────────────────────┘
        ↓                               ↓
Weigh-in Frequency              Monte Carlo Projection (js/projection.js)
(js/cycle.js)                           ↓
        ↓                       Trajectory Risk (js/adaptive.js — warning only)
        ↓                               ↓
UI (app.js, js/charts.js)
```

### Module Map

| Function | Module |
|----------|--------|
| `calculateBMR()` | calculations.js |
| `calculateInitialTDEE()` | calculations.js |
| `estimateAdaptiveTDEE()` | adaptive.js |
| `processWeightData()` / `estimateTrend()` | trend.js |
| `calculateRateOfGain()` | trend.js |
| `calculateTargetTrajectory()` | trajectory.js |
| `calculateTrajectoryError()` | trajectory.js |
| `estimateBodyComposition()` / `estimateBodyFat()` | composition.js |
| `compositionRange()` | calculations.js / composition.js |
| `calculateTrendConfidence()` | confidence.js |
| `runMonteCarloProjection()` | projection.js |
| `calculateTrajectoryRisk()` | adaptive.js (informational) |
| `calculateCalorieAdjustment()` | control.js |
| `updateWeighInFrequency()` | cycle.js |

---

## 2. Design Principles (V2.1)

1. **Trajectory over snapshots** — decisions use smoothed trend, not daily weight
2. **No false precision** — intervals, confidence labels, explicit uncertainty; σ values marked heuristic where not validated
3. **Control ≠ composition** — calories respond to **weight trajectory only**; BF/risk are warnings, not control inputs
4. **Intake is unknown** — calorie target ≠ logged food; TDEE inference is weak unless trend is strong
5. **Simplest defensible model** — benchmark-driven simplification (Huber WLS removed; rolling OLS retained)

---

## 3. Algorithm Comparison (Major Components)

### Trend Estimation

| Method | Verdict |
|--------|---------|
| EMA only (V1) | Rejected — lags, no rate SE, poor outlier handling |
| Kalman filter | Rejected — overkill for 1–2 measures/week; hard to debug |
| **Rolling OLS + outlier downweight (V2.1)** | **Selected** — benchmark beat Huber on complexity; EMA alone rejected |
| Huber WLS (V2.0) | Removed — marginal improvement (<8%) over OLS |

### Outlier Detection

| Method | Verdict |
|--------|---------|
| MAD modified Z-score | Used (n ≥ 5) |
| IQR rule | Used additionally (n ≥ 8) |
| Fixed kg threshold | Fallback when MAD = 0 |

### TDEE Adaptation

| Method | Verdict |
|--------|---------|
| Point estimate from target intake (V1) | Rejected — false precision |
| **Smoothed implied TDEE + wide range (V2)** | **Selected** — honest about unknown intake |

### BF Fusion

| Method | Verdict |
|--------|---------|
| Fixed 60/40 Navy blend (V1) | Rejected — arbitrary |
| **Inverse-variance weighting (V2)** | **Selected** — statistically standard |

---

## 4. Data Model

Storage key: `masscience_data`

```json
{
  "version": "1.0.0",
  "algorithmVersion": "2.1.0",
  "profile": { "age", "sex", "heightCm", "weightKg", "bodyFatPercent", "trainingYears", "trainingSessions", "activityLevel" },
  "settings": { "units", "theme", "bulkWeeks", "minicutWeeks", "notifications", "showAlgorithmDetails" },
  "currentCycle": { "id", "number", "startDate", "phaseStartDate", "phase", "phaseWeeks", "initialTDEE", "initialWeight", "maxBf", "algorithmVersion" },
  "weightMeasurements": [{ "date", "weight", "isEstimated", "isOutlier", "trendWeight", "modifiedZ" }],
  "bodyMeasurements": [{ "date", "waist", "neck", "hip", "chest", "arm", "thigh", "photo" }],
  "calorieHistory": [{ "date", "previous", "new", "adjustment", "reason", "status" }],
  "algorithmState": { "estimatedTDEE", "tdeeConfidence", "tdeeRange", "currentCalories", "smoothedBf", "weighInFrequency", "frequencyPhaseStart", "lastCalorieAdjustment", "consistencyScore" }
}
```

**Critical:** `isEstimated: true` measurements are NOT equivalent to measured weights.

---

## 5. BMR — Mifflin-St Jeor (1990)

**Male:** `BMR = 10W + 6.25H − 5A + 5`  
**Female:** `BMR = 10W + 6.25H − 5A − 161`

- W = kg, H = cm, A = years  
- **Reference:** Mifflin MD et al. *Am J Clin Nutr.* 1990;51:241-247  
- **Limitation:** Population average; ±10–15% individual variation typical  
- **Code:** `calculateBMR()` in `calculations.js`

---

## 6. Initial TDEE

```
TDEE = BMR × activityMultiplier
```

| Level | Multiplier |
|-------|------------|
| sedentary | 1.2 |
| lightly_active | 1.375 |
| moderately_active | 1.55 |
| very_active | 1.725 |
| extremely_active | 1.9 |

Initial range: `±10%` (heuristic uncertainty for formula-based estimate).

**Reference:** Standard PAL factors derived from FAO/WHO/UNU energy requirements framework.

Initial bulk calories: `TDEE + 300 kcal`  
Initial minicut: `TDEE − 500 kcal`

**Important:** +300 kcal does NOT guarantee any specific kg/week gain. Trajectory feedback has priority.

---

## 7. Trend Weight Engine (V2.1)

### Method

1. Use **measured** weights only for primary fit (estimated weights excluded from fit)
2. Fixed rolling window: `W = clamp(n, 7, 14)` days
3. **Single-pass weighted OLS** with outlier downweighting (Huber iterations removed)
4. Trend at day t: `T(t) = slope × t + intercept`
5. Change-point detection **removed from control path**

### Measurement weights in WLS

| Type | Weight |
|------|--------|
| Measured | 1.0 |
| Estimated | 0.10 (not used in fit) |
| Outlier (in fit) | 0.06 on y = trendWeight |

### Outlier detection

```
modifiedZ = |0.6745 × (x − median)| / MAD
outlier if modifiedZ > 3.5 OR |x − median| > 0.9 kg (when MAD = 0)
trendWeight = median + damped offset
```

**Benchmark:** `node js/tests/benchmark-trend.js`

Original `weight` always preserved in storage.

### Rate of gain

```
ratePerDay = WLS slope on last W days (effective y for outliers)
ratePerWeek = ratePerDay × 7
ratePercentPerWeek = ratePerWeek / trendWeight × 100
standardError = regression SE × 7 / √n
```

**Code:** `processWeightData()`, `calculateRateOfGain()` in `trend.js`

---

## 8. Target Trajectory

```
TargetWeight(d) = startWeight + (targetRateKgPerWeek / 7) × d
trajectoryErrorKg = actualTrend(d) − TargetWeight(d)
```

Primary control compares **actual trend** vs **target trajectory**, not raw weight.

**Code:** `trajectory.js`

---

## 9. Target Gain Rate (% Bodyweight)

Base bulk: **0.20–0.45% BW/week**, target 0.30%

Adjustments:
- Training ≥ 5 yr: −0.08%/wk
- Training < 2 yr: +0.08%/wk  
- BF < 12%: +0.05%/wk
- BF > 18%: −0.08%/wk

Convert: `targetKgPerWeek = (targetPercent / 100) × currentWeight`

Minicut: 0.4–1.0% BW/week loss, target 0.65%

**Reference:** Conservative bulk rates align with Helms et al. recommendations (~0.25–0.5% BW/week for lean gains).

**Code:** `recommendedGainRange()` in `calculations.js`

---

## 10. Body Fat Estimation (V2.1)

**Module:** `js/composition.js` — separate from calorie control.

### Sources and uncertainty (σ) — heuristic

| Source | σ (% points) |
|--------|-------------|
| User declared | 3.0 (H) |
| Navy formula | 4.0 (H) |

Waist-trend source removed (overfit risk).

### Fusion + inertia

```
fused = inverse-variance(user, navy)
smoothed = prev + α × (fused − prev)
maxChange = max(0.12%/wk × weeks, |Δweight| × 0.03%/kg, floor)
```

Without direct measurement, α = 0.05; with Navy, α = 0.30.

**Never present as measured BF.**

---

## 11. Composition & Partitioning

### From BF

```
fatMass = weight × (BF/100)
leanMass = weight − fatMass
```

Ranges: compute at BF_low and BF_high.

### Bulk partition (adaptive lean fraction)

Default lean fraction 0.55; 0.70 novice; 0.40 advanced; ±0.05 for BF.

### Minicut partition (sampled ranges in MC)

**Early (≤7 days):** fat 8–35%, lean 4–18%, water remainder  
**Steady:** fat 55–82%, lean 8–22%, water remainder  

Deterministic midpoint used for point estimates; MC samples uniformly within ranges.

**Code:** `composition.js`, `partitionWeightChange()` in `calculations.js`

---

## 12. Adaptive TDEE (V2)

### Assumption
User follows calorie **target**, not logged intake → `INTAKE_UNCERTAINTY = 200 kcal`.

### Implied TDEE

```
energyImbalance = (ratePerWeek / 7) × KCAL_PER_KG    [default 7700]
impliedTDEE = calorieTarget − energyImbalance
learned = prevTDEE + 0.25 × (impliedTDEE − prevTDEE)
```

Bounded: `[1200, 6000]`, max shift ±175 kcal/update.

### Range

```
halfWidth = imbalanceUncertainty + 200 + (100 − trendConfidence)
[low, high] = estimate ± halfWidth
```

**Reference:** Hall KD. *Am J Clin Nutr.* 2008 — ~7700 kcal/kg mixed tissue (sensitivity 7000–9000).

**Code:** `estimateAdaptiveTDEE()` in `adaptive.js`

---

## 13. Calorie Controller (V2.1)

**Module:** `js/control.js` — **weight trajectory only**. BF and trajectory risk do NOT affect calories.

### Combined error
```
error = 0.85 × rateError + 0.15 × (trajectoryErrorKg / dayIndex)
```

Only if `trendConfidence ≥ 45%` and outside 7-day cooldown.

**Code:** `calculateCalorieAdjustment()` in `control.js`

---

## 14. Trajectory Risk (informational)

Monte Carlo: `modelProbabilityExceedCeiling` from 800 simulations.

Displayed as **Estimated trajectory risk: LOW / MODERATE / HIGH** with disclaimer: *model-estimated probability — not clinical*.

Does **not** change calorie targets in V2.1.

**Code:** `calculateTrajectoryRisk()` in `adaptive.js`

---

## 15. Monte Carlo Projection (V2.1)

```
For i = 1..800:
  rate_i ~ truncated Normal(rateMean, rateSE)
  partition ~ sampleMinicutPartition / sampleBulkPartition
  simulate end weight, BF, lean mass
Report 16th, 50th, 84th percentiles
```

Convergence benchmark (`node js/tests/benchmark-mc.js`): 800 sims within ~0.3pp of 5000-run P(exceed).

**Code:** `runMonteCarloProjection()` in `projection.js`

---

## 16. Confidence Model

Separate scores 0–100:

| Score | Components |
|-------|------------|
| trendConfidence | n, span, R², residual CV, rate SE, missing-day penalty |
| tdeeConfidence | days, trend conf, intake-known penalty |
| bfConfidence | source count, average σ |
| projectionConfidence | weighted blend × time decay |

Labels: very_low (<40), low (40–55), moderate (55–72), high (72–85), very_high (>85)

**Code:** `confidence.js`

---

## 17. Weigh-in Frequency

Confidence-based state machine:

| Transition | Condition |
|------------|-----------|
| → daily | confidence < 35 OR unstable OR change-point |
| daily → every_other | confidence ≥ 65, stable, post-calibration |
| every_other → 3×/wk | confidence ≥ 78, stable, ≥7 days in phase |

**Code:** `updateWeighInFrequency()` in `cycle.js`

---

## 18. Missing Weight Estimation

```
estimatedWeight = lastTrend + ratePerDay × daysSinceLastMeasure
```

- Marked `isEstimated: true`
- Max 5 consecutive estimated days without new measurement
- **Never** used at full weight in regression fit

---

## 19. Macros

```
protein = 2.0 g/kg (range 1.6–2.4)
fat = max(0.8 g/kg, 20% kcal)
carbs = (calories − protein×4 − fat×9) / 4
```

Macros reconciled to calorie target (internal precision, display rounded).

**Reference:** ISSN position stand on protein (1.6–2.2 g/kg for hypertrophy).

---

## 20. Water Target

```
ml = 35 × weightKg + 450 × trainingSessions + activityBonus
```

Activity bonus: 0–1000 ml by activity level. Display as approximate.

---

## 21. Constants Table

See `js/constants.js` — every constant documented with purpose. Key values:

| Constant | Value | Purpose |
|----------|------:|---------|
| KCAL_PER_KG | 7700 | Energy density |
| HUBER_DELTA_KG | 0.35 | Robust regression |
| DEADBAND_KG_PER_WEEK | 0.025 | Controller deadband |
| ADJUSTMENT_COOLDOWN_DAYS | 7 | Anti-oscillation |
| MONTE_CARLO.SIMULATIONS | 400 | Projection MC |
| SIGMA_USER_BF | 2.5 | BF fusion |
| SIGMA_NAVY_BF | 3.5 | BF fusion |

---

## 22. Sensitivity Analysis

| Parameter | Effect if wrong |
|-----------|-----------------|
| KCAL 7000 vs 9000 | TDEE inference ±~15% |
| BF ± 2% | Lean mass ±~1.5 kg at 75 kg |
| rate ± 0.05 kg/wk | Calorie adj ±~50–100 kcal |
| Lean partition ±10% | BF projection ±~0.5–1% over 10 wk |

Monte Carlo propagates rate, BF, and partition uncertainty.

---

## 23. Synthetic Tests

Run: `node js/tests/run-tests.js`

| Scenario | Expected |
|----------|----------|
| Stable gain at target | GREEN, no adjustment |
| Fast +0.40 kg/wk | Negative adjustment |
| Water spike | Outlier flagged, rate damped |
| Missing measurements | Estimated weights, no hang |
| Minicut partition | Sums to 100% |
| MC projection | Interval width > 0 |
| TDEE | Returns range |
| Slow gain | Positive adjustment |

---

## 24. Debugging

Enable **Show algorithm debug panel** in Settings, or:

```javascript
window.masscience.computed
// trendData, trajectoryError, tdeeResult, bfEstimate, projection, risk, controllerState
```

---

## 25. Limitations

Masscience **cannot** accurately determine: exact BF, muscle gain, maintenance calories, nutrient partitioning, or future weight. It monitors **trajectory** and applies **conservative control** with explicit uncertainty.

---

## 26. Version History

| Version | Date | Summary |
|---------|------|---------|
| 2.1.0 | 2026 | Second audit: split control/composition; rolling OLS; BF inertia; MC partition ranges; 800 sims |
| 2.0.0 | 2026 | Full mathematical audit; robust trend; MC projections; inverse-variance BF |
| 1.0.0 | 2026 | Initial release (superseded) |

When updating algorithms: increment `ALGORITHM_VERSION`, document in CHANGELOG, extend `migrateState()` if needed.

---

## 27. Scientific References

1. Mifflin MD et al. (1990) — BMR equation  
2. Hall KD (2008) — energy density of weight change (~7700 kcal/kg)  
3. Hodgdon & Beckett — US Navy circumference BF equations  
4. Helms ER et al. — conservative bulk rate recommendations  
5. ISSN (2017) — protein intake for muscle hypertrophy  
6. FAO/WHO/UNU — physical activity level multipliers  

---

*End of V2.0 Architecture Specification*
