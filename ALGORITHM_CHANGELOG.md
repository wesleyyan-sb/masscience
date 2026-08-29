# Masscience Algorithm Changelog

## Version 2.1.0 (2026)

### Motivation
V2.0 added rigor but introduced overfitting risk, false precision, and unnecessary complexity. V2.1 simplifies where benchmarks showed marginal benefit and separates **control** from **composition**.

### What changed

| Area | V2.1 change |
|------|-------------|
| **Trend** | Huber WLS removed → rolling OLS + outlier downweight (benchmark: Huber <8% better than OLS) |
| **Change-point** | Removed from control path |
| **Control** | Moved to `js/control.js`; weight trajectory only — BF/risk never adjust calories |
| **Composition** | New `js/composition.js`; BF inertia; waist-trend source removed |
| **BF σ** | Relabeled heuristic: user 3%, Navy 4% |
| **Minicut MC** | Fixed partitions → sampled ranges (early/steady) |
| **Monte Carlo** | 400 → 800 sims; truncated-normal rates; convergence validated |
| **Risk UX** | "Estimated trajectory risk" + model probability disclaimer |
| **Tests** | 14 tests including BF inertia + controller simulation |

### Benchmarks
- `node js/tests/benchmark-trend.js` — method comparison
- `node js/tests/benchmark-mc.js` — MC convergence
- `node js/tests/run-tests.js` — regression suite

### Migration
- `algorithmState.smoothedBf` added for BF inertia persistence
- V2.0 state loads via `migrateState()`; recomputes on next session

---

## Version 2.0.0 (2026)

### What was wrong with V1.0

| Area | V1.0 Problem |
|------|----------------|
| **Trend model** | Single EMA (α=0.15) + fixed 14-day regression; no adaptive window; rate used raw weights including outliers |
| **BF estimation** | Arbitrary `Navy × 0.6 + user × 0.4` blend with no statistical basis; false precision (single decimal) |
| **Minicut partition** | Fat 75% + lean 20% + water 25% = **120%** — mathematically inconsistent |
| **TDEE learning** | Treated calorie *target* as exact intake; returned single point with overconfident score |
| **Calorie controller** | `adjustment = -(error/7) × 7700 × 0.5` with no confidence weighting; could oscillate |
| **Max BF ceiling** | Opaque heuristic (`bfIncrease / 70 × 100 × 0.5 + 2`) with no range or probability |
| **Projections** | Point estimates only; uncertainty did not widen with time |
| **Confidence** | Single arbitrary score mixing unrelated inputs |
| **Weigh-in frequency** | CV-only stability; calendar rules without confidence thresholds |
| **Missing weights** | `continue` without date increment caused **infinite loop** when streak exceeded max |
| **Monte Carlo** | `randomNormal()` infinite loop when RNG returned exactly 0 |
| **Gain targets** | Fixed kg/week for all users; ignored bodyweight scaling |

### What changed in V2.0

#### Trend engine (`js/trend.js`)
- **Primary method:** Huber-weighted rolling WLS on measured points (rejected Kalman filter — sparse data, poor debuggability)
- Adaptive window 7–21 days based on sample size and residual CV
- Separate concepts: `measured`, `estimated`, `trend`, `noise`
- Outliers: MAD + IQR; original preserved; damped `trendWeight` used in regression
- Rate-of-gain uses effective weight (outliers down-weighted), reports `standardError`, `perWeekPercent`
- Change-point detection: compares first/second half slopes
- Fixed missing-weight interpolation loop

#### Body fat (`js/calculations.js`)
- **Inverse-variance fusion** of user estimate (σ=2.5%), Navy (σ=3.5%), optional waist trend (σ=2.0%)
- Output: estimate + 95% interval + separate `bfConfidence`
- Composition ranges propagate BF uncertainty to lean/fat mass
- Explicit: lean mass ≠ skeletal muscle

#### Gain targets
- Primary unit: **% bodyweight/week** (Helms-style conservative bulk ~0.2–0.45%/wk)
- Converted to kg/week per user weight
- Adjusted for training age and BF

#### TDEE (`js/adaptive.js`)
- Acknowledges intake is **target-only** (not logged food)
- Returns `estimate`, `low`, `high`, `confidence`
- Wide range when trend confidence low or intake unknown

#### Calorie controller
- Combined **rate error** (70%) + **trajectory error** (30%)
- Discrete steps: 50/100/150/200 kcal scaled by confidence
- 7-day cooldown, deadband, minimum evidence (confidence ≥ 45%)
- Explanatory messages with reasoning

#### Projections (`js/projection.js`)
- **Monte Carlo** (400 sims, seeded) for weight, BF, lean mass, FFMI
- Outputs 16th–84th percentile intervals
- `P(exceed BF ceiling)` for trajectory risk

#### Minicut partition
- Early phase (≤7 days): 30% fat / 10% lean / 60% water-glycogen
- Steady phase: 80% fat / 15% lean / 5% water — **sums to 100%**

#### Confidence (`js/confidence.js`)
- Separate scores: `trendConfidence`, `tdeeConfidence`, `bfConfidence`, `projectionConfidence`

#### Weigh-in frequency (`js/cycle.js`)
- Confidence-based state machine with thresholds (35/50/65/78%)

### Expected improvement
- Fewer false calorie adjustments from water spikes and single-day noise
- Honest uncertainty display reduces false precision anxiety
- Trajectory-risk framing more actionable than arbitrary RED/YELLOW/GREEN
- Minicut and bulk projections statistically consistent
- Developer can replace any module independently

### Remaining limitations
- Cannot know exact food intake, muscle gain, or BF without lab measurement
- Monte Carlo assumes normal rate uncertainty — real distributions are skewed
- Navy BF formula has known population-level error (~±3–4%)
- 7700 kcal/kg energy density is approximate (Hall 2008; actual range ~7000–9500)
- No explicit creatine/sodium event logging (change-point detection partial mitigation)
- Client-side MC limited to 400 simulations for performance

### Migration
- `algorithmVersion` stored in state and cycles
- V1 data loads via `migrateState()`; algorithms recompute on next `recompute()`
- No automatic backfill of historical confidence intervals

---

## Version 1.0.0

Initial release. See git history / prior ARCHITECTURE.md sections for V1 specification (superseded).
