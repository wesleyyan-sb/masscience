# Masscience Build Guide

This project is a browser-based application that can be packaged for the web, Windows desktop, Linux desktop, and Android.

## Prerequisites

- Node.js 20+
- npm
- Git
- Java JDK 17+
- Android Studio / Android SDK
- For desktop packaging: Electron Builder is installed via npm

## Local build

```bat
build.bat all
```

Or targeted builds:

```bat
build.bat web
build.bat windows
build.bat linux
build.bat android
build.bat clean
```

## NPM scripts

```bash
npm test
npm run web
npm run build:web
npm run build:windows
npm run build:linux
npm run build:android
npm run build:desktop
npm run build:all
```

## Web app

```bash
python -m http.server 8080
```

Then open:

```text
http://localhost:8080/
```

## Android setup

1. Install Android Studio.
2. Install Android SDK.
3. Set environment variables:
   - `ANDROID_HOME`
   - `ANDROID_SDK_ROOT`
4. Ensure `adb`, `sdkmanager`, and `gradlew` are available.

## GitHub Actions

The repository includes a workflow under `.github/workflows/build.yml` to build Windows, Linux, and Android artifacts on CI.

## Troubleshooting

### Android SDK not found

Install Android Studio and configure the SDK path.

### Build fails in Electron

Run:

```bash
npm install
npm run build:windows
npm run build:linux
```

### Tests fail

```bash
node js/tests/run-tests.js
```
