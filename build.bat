@echo off
setlocal enabledelayedexpansion

set "ROOT=%~dp0"
set "TARGET=%1"
if "%TARGET%"=="" set "TARGET=all"

set "DIST_DIR=%ROOT%dist"
set "WEB_DIR=%DIST_DIR%\web"
set "WINDOWS_DIR=%DIST_DIR%\windows"
set "LINUX_DIR=%DIST_DIR%\linux"
set "ANDROID_DIR=%DIST_DIR%\android"

call :banner
call :checkTool "node" "Node.js" "node --version"
call :checkTool "npm" "npm" "npm --version"

if /I "%TARGET%"=="help" (
  call :showHelp
  exit /b 0
)

if /I "%TARGET%"=="clean" (
  echo [1/4] Cleaning build artifacts...
  if exist "%DIST_DIR%" rmdir /s /q "%DIST_DIR%"
  echo Clean complete.
  exit /b 0
)

call :bumpVersion

if /I "%TARGET%"=="web" (
  call :buildWeb
  exit /b 0
)

if /I "%TARGET%"=="windows" (
  call :checkTool "npx" "npx" "npx --version"
  call :buildWindows
  exit /b 0
)

if /I "%TARGET%"=="linux" (
  call :checkTool "npx" "npx" "npx --version"
  call :buildLinux
  exit /b 0
)

if /I "%TARGET%"=="android" (
  call :checkAndroid
  call :buildAndroid
  exit /b 0
)

if /I "%TARGET%"=="all" (
  call :buildAll
  exit /b %ERRORLEVEL%
)

echo ERROR: Unknown target: %TARGET%
call :showHelp
exit /b 1

:bumpVersion
  echo [version] Bumping application version...
  call npm version patch --no-git-tag-version
  if errorlevel 1 exit /b 1
  call npm run version:sync
  if errorlevel 1 exit /b 1
  for /f "delims=" %%i in ('node -p "require(\"./package.json\").version"') do set "APP_VERSION=%%i"
  echo [version] Current version: %APP_VERSION%
  exit /b 0

:buildAll
  echo [1/6] Installing dependencies...
  call :npmCi || exit /b 1
  echo [2/6] Running tests...
  call :runTests || exit /b 1
  echo [3/6] Building web package...
  call :buildWeb || exit /b 1
  echo [4/6] Building Windows desktop package...
  call :buildWindows || exit /b 1
  echo [5/6] Building Linux desktop package...
  call :buildLinux || exit /b 1
  echo [6/6] Building Android APK...
  if exist "%ANDROID_SDK_ROOT%"  if not "%ANDROID_SDK_ROOT%"=="" (
    call :buildAndroid || exit /b 1
  ) else if exist "%ANDROID_HOME%"  if not "%ANDROID_HOME%"=="" (
    call :buildAndroid || exit /b 1
  ) else (
    echo [android] Android SDK not configured - skipping Android package.
    echo [android] Install Android Studio and configure ANDROID_HOME / ANDROID_SDK_ROOT to enable APK generation.
  )
  echo.
  echo Masscience Build Successful
  echo.
  echo Version: %APP_VERSION%
  echo.
  echo Artifacts:
  echo Windows: %WINDOWS_DIR%\
  echo Linux: %LINUX_DIR%\
  if exist "%ANDROID_SDK_ROOT%"  if not "%ANDROID_SDK_ROOT%"=="" (
    echo Android: %ANDROID_DIR%\
  ) else if exist "%ANDROID_HOME%"  if not "%ANDROID_HOME%"=="" (
    echo Android: %ANDROID_DIR%\
  ) else (
    echo Android: skipped (SDK not configured)
  )
  echo Web: %WEB_DIR%\
  echo Tests: PASS
  exit /b 0

:buildWeb
  echo [web] Building web output...
  call npm run build:web
  if errorlevel 1 exit /b 1
  exit /b 0

:buildWindows
  echo [windows] Building Windows installer...
  call npm run build:windows
  if errorlevel 1 exit /b 1
  exit /b 0

:buildLinux
  echo [linux] Building Linux package...
  call npm run build:linux
  if errorlevel 1 exit /b 1
  exit /b 0

:buildAndroid
  echo [android] Building Android APK...
  call npm run build:android
  if errorlevel 1 exit /b 1
  exit /b 0

:checkAndroid
  echo [android] Checking Java and Android SDK environment...
  call :checkTool "java" "Java" "java -version"
  if not exist "%ANDROID_SDK_ROOT%" if not exist "%ANDROID_HOME%" (
    echo ERROR: Android SDK was not found.
    echo Please install Android Studio and configure the Android SDK, then run build.bat again.
    exit /b 1
  )
  exit /b 0

:npmCi
  if exist "%ROOT%package-lock.json" (
    call npm ci
  ) else (
    call npm install
  )
  if errorlevel 1 exit /b 1
  exit /b 0

:runTests
  call npm test
  if errorlevel 1 exit /b 1
  exit /b 0

:banner
  echo ==================================================
  echo                MASSCIENCE BUILD
  echo ==================================================
  exit /b 0

:showHelp
  echo Usage: build.bat [all^|web^|windows^|linux^|android^|clean^|help]
  echo.
  echo Examples:
  echo   build.bat all
  echo   build.bat windows
  echo   build.bat linux
  echo   build.bat android
  echo   build.bat web
  echo   build.bat clean
  exit /b 0

:checkTool
  set "tool=%~1"
  set "label=%~2"
  set "cmd=%~3"
  where %tool% >nul 2>nul
  if errorlevel 1 (
    echo ERROR: %label% was not found in PATH.
    echo Please install %label% and rerun build.bat.
    exit /b 1
  )
  echo [ok] %label% detected.
  exit /b 0
