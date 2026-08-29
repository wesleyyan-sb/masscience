#!/usr/bin/env bash
set -euo pipefail

TARGET="${1:-all}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

case "$TARGET" in
  all|windows|linux|android|web|clean|help)
    ;;
  *)
    echo "Unknown target: $TARGET"
    echo "Usage: ./build.sh [all|web|windows|linux|android|clean|help]"
    exit 1
    ;;
esac

if [[ "$TARGET" == "help" ]]; then
  echo "Usage: ./build.sh [all|web|windows|linux|android|clean|help]"
  exit 0
fi

if [[ "$TARGET" == "clean" ]]; then
  rm -rf dist
  echo "Clean complete."
  exit 0
fi

if [[ "$TARGET" == "web" ]]; then
  npm run build:web
  exit 0
fi

if [[ "$TARGET" == "windows" ]]; then
  npm run build:windows
  exit 0
fi

if [[ "$TARGET" == "linux" ]]; then
  npm run build:linux
  exit 0
fi

if [[ "$TARGET" == "android" ]]; then
  npm run build:android
  exit 0
fi

npm test
npm run build:web
npm run build:windows
npm run build:linux
npm run build:android
