# Masscience Build Architecture

## Source reuse

Masscience is a single HTML/CSS/JavaScript application. The same frontend files remain shared across all targets.

## Packaging flow

```text
Source
  ↓
Web build
  ↓
  ┌───────────────┐
  │               │
  Electron        Capacitor
  │               │
  ├────────────┐  │
  │            │  │
  Windows     Linux  Android
```

## Why Electron

Electron is used for Windows and Linux desktop packaging because it preserves the same app logic and local storage model while wrapping the web app in a native shell.

## Why Capacitor

Capacitor is used for Android because it offers a mature path to package the same frontend as an Android app without rewriting the application logic.

## Data persistence

All application persistence remains local to the device. The app uses `localStorage`, which is preserved in the desktop and Android packaged builds unless the user clears app data.

## Build outputs

- `dist/web`
- `dist/windows`
- `dist/linux`
- `dist/android`

## CI/CD

GitHub Actions can run the same test and build commands used locally, uploading artifacts for release creation.
