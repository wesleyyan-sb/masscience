
-> [Download the latest version of Masscience from the /Releases section by clicking here!](https://github.com/wesleyyan-sb/masscience/releases/latest)
<div align="center">

# 🧬 Masscience

### Build Muscle. Control the Rate. Minimize Unnecessary Fat Gain.

**A privacy-first, client-side lean bulk & mini-cut companion built around bodyweight trends instead of obsessive calorie tracking.**

<br>

[![License](https://img.shields.io/badge/license-open--source-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Web%20%7C%20Windows%20%7C%20Linux%20%7C%20Android-informational.svg)](#-platforms)
[![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-yellow.svg)](#-technology-stack)
[![Electron](https://img.shields.io/badge/Desktop-Electron-47848F.svg)](#-desktop)
[![Android](https://img.shields.io/badge/Android-Capacitor-3DDC84.svg)](#-android)
[![GitHub Pages](https://img.shields.io/badge/Web-GitHub%20Pages-222222.svg)](#-web)
[![Client Side](https://img.shields.io/badge/backend-none-success.svg)](#-privacy-first)

<br>

**[🚀 Try Masscience](#-live-demo)** · **[📖 Documentation](#-documentation)** · **[🧮 Algorithms](#-algorithm)** · **[🤝 Contributing](#-contributing)**

</div>

---

## 🎯 What is Masscience?

Masscience is a **data-driven bodyweight and nutrition management application** designed for people who want to gain muscle while keeping unnecessary fat gain under control.

Traditional bulking often creates two extremes:

```text
"I'll just eat everything and hope I gain muscle."
```

or:

```text
"I need to weigh every ingredient of every meal."
```

Masscience takes a different approach.

### The core idea

> **You don't necessarily need to know exactly how many calories you ate. You need to know how your body is responding.**

Masscience observes the user's bodyweight trajectory and uses that information to estimate whether the current calorie target is producing the desired rate of gain.

---

# 🧠 How It Works

```text
             USER PROFILE
                  │
                  ▼
        ┌───────────────────┐
        │ Initial Estimates │
        │ BMR / TDEE / BF   │
        └─────────┬─────────┘
                  │
                  ▼
           LEAN BULK START
                  │
                  ▼
        ┌───────────────────┐
        │ Weight Collection │
        │ + Trend Analysis  │
        └─────────┬─────────┘
                  │
                  ▼
        ┌───────────────────┐
        │ Rate of Gain      │
        │ kg/week           │
        │ % BW/week         │
        └─────────┬─────────┘
                  │
                  ▼
        ┌───────────────────┐
        │ Control Engine    │
        │                   │
        │ Is the trajectory │
        │ on target?        │
        └─────────┬─────────┘
                  │
           ┌──────┴──────┐
           ▼             ▼
        ON TARGET      OFF TARGET
           │             │
           │             ▼
           │       Adjust Calories
           │
           └──────┬──────┘
                  ▼
             CONTINUE
                  │
                  ▼
          BULK PROJECTION
                  │
                  ▼
             MINI-CUT
                  │
                  ▼
               REPEAT
```

The user does not need to understand the mathematics behind this system.

**Masscience handles the calculations.**

---

# ⚡ Core Features

## 🏋️ Lean Bulk / Mini-Cut Cycles

Masscience uses a default cycle of:

```text
10 weeks — Lean Bulk
       ↓
3 weeks — Mini-Cut
       ↓
Repeat
```

Initial calorie targets:

| Phase     |          Target |
| --------- | --------------: |
| Lean Bulk | TDEE + 300 kcal |
| Mini-Cut  | TDEE − 500 kcal |

The system can adapt the calorie target based on observed weight trajectory.

---

## ⚖️ Smart Weigh-In Frequency

One of the main goals of Masscience is to reduce the annoyance of constant weighing.

Instead of requiring daily measurements indefinitely, the application progressively reduces the frequency when enough evidence exists.

```text
┌────────────────────┐
│ First 10 days      │
│ DAILY               │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ Every other day    │
└─────────┬──────────┘
          ↓
┌────────────────────┐
│ 3× per week        │
└─────────┬──────────┘
          ↓
      Maintain
```

If the trend becomes unreliable, Masscience can increase measurement frequency again.

### Missing days

When a measurement is missing, Masscience can estimate the expected weight using the current trend.

Estimated values are explicitly marked as:

```text
ESTIMATED
```

They are never presented as actual measurements.

---

# 📈 Intelligent Weight Tracking

Daily bodyweight is noisy.

A person can gain or lose more than a kilogram without meaningfully changing their body composition.

Masscience therefore analyzes the **trend**, rather than reacting to individual measurements.

The trend engine accounts for:

* day-to-day noise
* outliers
* measurement frequency
* rolling observation windows
* regression
* trend confidence
* rate of change

Primary metrics:

```text
Current weight
Trend weight
Rate of gain
% bodyweight/week
Trend confidence
```

---

# 🎯 Adaptive Gain Targets

Masscience does not simply tell everyone:

```text
Gain 0.2 kg/week.
```

Instead, its primary target is expressed relative to bodyweight:

```text
% bodyweight / week
```

This makes the target scale between users.

The target can be influenced by:

* bodyweight
* training age
* current BF estimate
* training frequency

The objective is a conservative bulk with enough progression to support muscle gain while avoiding unnecessarily aggressive weight gain.

---

# 🧠 Adaptive TDEE

Masscience starts with an estimated TDEE:

```text
BMR × Activity Factor
```

As the user accumulates data, the application can infer an effective TDEE from:

```text
Observed weight change
+
Calorie target
+
Time
```

The system intentionally distinguishes between:

```text
Calories prescribed
```

and:

```text
Calories actually consumed
```

If the user does not log their food intake, Masscience **cannot know their exact intake**.

Therefore TDEE is presented as an estimate with uncertainty.

---

# 🧬 Body Composition

Masscience estimates:

* Body-fat %
* Fat mass
* Lean mass
* FFMI

Possible inputs include:

* initial user estimate
* waist circumference
* neck circumference
* height
* bodyweight

The application can use the U.S. Navy body-fat equation when appropriate.

### Important distinction

```text
Lean Mass ≠ Muscle Mass
```

Lean mass contains water and other non-fat tissues in addition to skeletal muscle.

Masscience does not pretend that an estimated increase in lean mass is an exact measurement of muscle growth.

---

# 🔮 Future Projection

Masscience can simulate possible outcomes for the end of a cycle.

Instead of producing:

```text
You WILL weigh 68.4 kg.
```

it produces an estimated distribution:

```text
Expected weight

      16%       50%       84%
       │         │         │
       ▼         ▼         ▼
     67.2      68.0      68.9 kg
```

The projection engine uses **Monte Carlo simulation** to model uncertainty in future trajectories.

Possible outputs include:

* projected weight
* projected BF
* projected lean mass
* projected fat mass
* projected FFMI
* trajectory risk

---

# 🎛️ Adaptive Calorie Controller

Masscience uses a conservative feedback-control system.

```text
             TARGET RATE
                  │
                  ▼
          ┌───────────────┐
          │ Compare with  │
          │ actual trend  │
          └───────┬───────┘
                  │
                  ▼
              RATE ERROR
                  │
                  ▼
             CONFIDENCE
                  │
                  ▼
          ┌───────────────┐
          │ Controller    │
          │ + Deadband    │
          │ + Cooldown    │
          └───────┬───────┘
                  │
                  ▼
          CALORIE ADJUSTMENT
```

The controller deliberately avoids making large changes based on a single noisy measurement.

It uses:

* rate error
* trajectory error
* confidence
* deadband
* minimum evidence
* discrete adjustment steps
* cooldown periods

---

# 📊 Confidence Instead of False Precision

Masscience does not use one giant "accuracy score."

Different parts of the system have different uncertainty.

Therefore it maintains separate confidence concepts:

| Metric                | Meaning                                      |
| --------------------- | -------------------------------------------- |
| Trend Confidence      | How reliable the observed weight trend is    |
| TDEE Confidence       | How much evidence supports the TDEE estimate |
| BF Confidence         | Confidence in body-fat estimation            |
| Projection Confidence | Confidence in future trajectory              |

This allows the application to communicate uncertainty honestly.

---

# 🔬 Algorithm

Current algorithm version:

```text
2.1.0
```

Masscience's mathematical engine is modular.

```text
js/
├── calculations.js
├── trend.js
├── composition.js
├── control.js
├── adaptive.js
├── projection.js
├── confidence.js
├── cycle.js
└── storage.js
```

### Trend

Current approach:

```text
Rolling OLS
+
Outlier downweighting
+
Adaptive observation window
```

### Composition

Current approach:

```text
User BF estimate
+
Navy method
+
BF inertia
+
Uncertainty propagation
```

### Control

Current approach:

```text
Weight trajectory
+
Rate error
+
Trajectory error
+
Confidence
+
Deadband
+
Cooldown
```

### Projection

Current approach:

```text
Monte Carlo
+
Truncated-normal rate distribution
+
Uncertainty propagation
```

---

# 🧪 Algorithm Development

Masscience treats its mathematical model as a first-class part of the project.

Every major algorithm should be:

* documented
* testable
* benchmarkable
* replaceable
* versioned

Algorithm changes are recorded in:

```text
ALGORITHM_CHANGELOG.md
```

Complete mathematical documentation:

```text
ARCHITECTURE.md
```

Build architecture:

```text
BUILD_ARCHITECTURE.md
```

---

# 🖥️ Platforms

| Platform   | Technology  | Output      | Offline |
| ---------- | ----------- | ----------- | :-----: |
| 🌐 Web     | HTML/CSS/JS | Web App     |    ✅    |
| 🪟 Windows | Electron    | `.exe`      |    ✅    |
| 🐧 Linux   | Electron    | `.AppImage` |    ✅    |
| 🤖 Android | Capacitor   | `.apk`      |    ✅    |

The same frontend is reused across all platforms.

```text
                  HTML
                   │
             CSS + JavaScript
                   │
       ┌───────────┼───────────┐
       │           │           │
      Web       Electron    Capacitor
       │           │           │
       ▼       ┌───┴───┐       ▼
   Browser     Win   Linux    Android
```

---

# 🚀 Live Demo

### 🌐 Try Masscience

**[Open the Web App](#)**

No account required.

No backend required.

No installation required.

---

# 📦 Installation

## Web

Simply open the deployed GitHub Pages application.

Or run locally:

```bash
git clone https://github.com/wesleyyan-sb/masscience.git
cd masscience
npm ci
npm run dev
```

---

## Windows / Linux / Android

Masscience includes an automated build system.

On Windows:

```bat
build.bat
```

One command can build:

```text
Windows installer
Linux AppImage
Android APK
Web build
```

Individual targets can also be built:

```bat
build.bat windows
build.bat linux
build.bat android
build.bat web
```

More information:

```text
BUILD.md
```

---

# ⚙️ Automated Builds

Masscience is designed around reproducible builds.

```text
Developer
    │
    ▼
build.bat
    │
    ├───────────────┐
    ▼               ▼
Web Build       Electron
                    │
              ┌─────┴─────┐
              ▼           ▼
           Windows      Linux
              │           │
             .exe     .AppImage
                   

Capacitor
    │
    ▼
 Android
    │
   .apk
```

GitHub Actions can also generate platform artifacts automatically.

---

# 🔐 Privacy First

Masscience is designed to be **client-side and privacy-first**.

Your data can remain entirely on your device.

There is no required:

* account
* backend
* cloud database
* telemetry server
* external AI
* nutrition API
* subscription

The application can work offline.

Your:

```text
Weight
BF estimates
Measurements
Calories
Cycle history
Projections
```

do not need to leave your device.

---

# 📴 Offline-First

Core functionality is designed to work without an internet connection.

Offline functionality includes:

* weight tracking
* trend analysis
* BF estimation
* TDEE estimation
* calorie recommendations
* projections
* Monte Carlo simulations
* charts
* local persistence
* cycle management

Internet access is primarily useful for things such as downloading the application or accessing the web deployment.

---

# 🧪 Testing

Run the regression suite:

```bash
node js/tests/run-tests.js
```

Trend benchmark:

```bash
node js/tests/benchmark-trend.js
```

Monte Carlo benchmark:

```bash
node js/tests/benchmark-mc.js
```

The test suite covers areas such as:

* trend calculations
* outlier detection
* missing measurements
* BF inertia
* controller behavior
* Monte Carlo convergence
* cycle transitions
* projection behavior

---

# 🛣️ Roadmap

### Core

* [x] Lean bulk cycle
* [x] Mini-cut cycle
* [x] Weight tracking
* [x] Trend analysis
* [x] Adaptive calorie control
* [x] BF estimation
* [x] FFMI estimation
* [x] Cycle projections
* [x] Monte Carlo projections
* [x] Confidence system
* [x] Smart weigh-in frequency

### Platforms

* [x] Web
* [x] Windows
* [x] Linux
* [x] Android
* [x] Automated builds
* [x] Automated signed releases

### Future

* [ ] Progressive overload tracking
* [ ] Training integration
* [ ] Optional food tracking
* [ ] Better water/glycogen event detection
* [ ] Improved uncertainty calibration
* [ ] Additional body-composition models
* [ ] Expanded benchmark datasets
* [ ] iOS support
* [ ] More detailed analytics
* [ ] Import/export improvements

---

# 🤝 Contributing

Masscience is open source and contributions are welcome.

You can contribute with:

### 💻 Code

* frontend
* algorithms
* performance
* desktop
* Android
* testing
* build infrastructure

### 🧮 Mathematics

Particularly valuable contributions include:

* better trend estimators
* better TDEE models
* better body-composition estimation
* improved uncertainty modeling
* improved projection distributions
* real-world benchmark datasets

### 🎨 Design

* UI/UX
* accessibility
* responsive layouts
* mobile experience
* visualization

### 📚 Documentation

* algorithm explanations
* examples
* translations
* tutorials

---

# ⚠️ Limitations

Masscience cannot know with certainty:

* exact TDEE
* exact calorie intake without logging
* exact body-fat percentage
* exact muscle gain
* exact nutrient partitioning
* exact future weight
* exact metabolic adaptation

Human physiology is noisy and highly individual.

The application's projections are **model-based estimates**, not guarantees.

---

# 🩺 Health Disclaimer

Masscience is an informational and educational tool.

It is not a substitute for individualized advice from a qualified healthcare or nutrition professional.

The application should not be used as the sole basis for medical or nutritional decisions.

---

# 📜 License

Masscience is open source.

See [`LICENSE`](LICENSE) for the complete license.

---

# ⭐ Philosophy

Masscience exists because building muscle shouldn't require turning your life into a spreadsheet.

You shouldn't necessarily have to:

```text
weigh every ingredient
        +
track every meal
        +
panic over daily weight fluctuations
```

Instead:

```text
Train
  ↓
Eat
  ↓
Measure
  ↓
Observe the trend
  ↓
Adjust
  ↓
Repeat
```

The goal isn't perfect prediction.

The goal is **better decisions from imperfect data**.

---

<div align="center">

## 🧬 Masscience

**Measure less obsessively. Understand the trend. Build muscle.**

<br>

[![GitHub](https://img.shields.io/badge/GitHub-Repository-181717?logo=github)](#)
[![Open Source](https://img.shields.io/badge/Open%20Source-Yes-success.svg)](#)
[![Privacy](https://img.shields.io/badge/Privacy-Client--Side-blue.svg)](#)

<br>

**Made for people who want to bulk smarter.**

</div>