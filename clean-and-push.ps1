$ErrorActionPreference = 'Stop'

$repo = Get-Location
Write-Host "==> Masscience cleanup and push script" -ForegroundColor Cyan

# Remove generated folders if present
$paths = @(
  'dist',
  'node_modules',
  'android/.gradle',
  'android/app/build'
)

foreach ($p in $paths) {
  if (Test-Path $p) {
    Write-Host "Removing $p..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force $p
  }
}

# Ensure .gitignore exists
if (-not (Test-Path '.gitignore')) {
  New-Item -Path '.gitignore' -ItemType File | Out-Null
}

# Add ignore rules if missing
$rules = @(
  'node_modules/',
  'dist/',
  'android/.gradle/',
  'android/**/build/',
  '.DS_Store'
)

$content = @(Get-Content '.gitignore' -ErrorAction SilentlyContinue)
foreach ($rule in $rules) {
  if ($content -notcontains $rule) {
    $content += $rule
  }
}
Set-Content -Path '.gitignore' -Value $content

# Untrack large build artifacts from git if they were previously committed
foreach ($p in $paths) {
  if (Test-Path $p) {
    git rm -r --cached $p --ignore-unmatch | Out-Null
  }
}

git add .gitignore
Write-Host "" 
Write-Host "Review the status before commit:" -ForegroundColor Cyan
git status --short --branch

Write-Host "" 
Write-Host "Run this next manually if you want to push:" -ForegroundColor Cyan
Write-Host 'git commit -m "remove build artifacts"' -ForegroundColor Green
Write-Host 'git push origin main' -ForegroundColor Green
