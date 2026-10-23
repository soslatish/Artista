# Локальный запуск Artista на Windows: база + API (Docker) и мобильное приложение (Expo).
# Запуск из корня репозитория:  powershell -ExecutionPolicy Bypass -File .\start.ps1
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Не найден $cmd. $hint" -ForegroundColor Red; exit 1 }
}
Need docker 'Установите и запустите Docker Desktop.'
Need npm 'Установите Node.js 20+ (https://nodejs.org).'
docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host 'Docker Desktop не запущен — откройте его и повторите.' -ForegroundColor Red; exit 1 }

# IP компьютера в локальной сети — по нему телефон с Expo Go достучится до API
$ip = (Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } |
  Select-Object -First 1).IPv4Address.IPAddress
if (-not $ip) { $ip = 'localhost' }
$api = "http://${ip}:8080"
Write-Host "API будет доступен по адресу $api" -ForegroundColor Cyan

# .env с секретами создаётся один раз
$envFile = Join-Path $root 'infra\.env'
function RandomSecret([int]$n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }
$firstRun = -not (Test-Path $envFile)
if ($firstRun) {
  @(
    'APP_ENV=dev'
    "POSTGRES_PASSWORD=$(RandomSecret 24)"
    "JWT_SECRET=$(RandomSecret 48)"
    "PUBLIC_BASE_URL=$api"
    'PAYMENTS_PROVIDER=stub'
    'ALLOW_STUB_PAYMENTS=true'
    'CORS_ORIGINS=*'
    'HTTP_PORT=8080'
  ) | Set-Content -Encoding ascii $envFile
} else {
  # IP мог смениться — обновим адрес для ссылок на фото
  (Get-Content $envFile) -replace '^PUBLIC_BASE_URL=.*', "PUBLIC_BASE_URL=$api" | Set-Content -Encoding ascii $envFile
}

$compose = @('compose', '-f', 'infra\docker-compose.yml', '--env-file', $envFile)
Write-Host 'Собираю и запускаю базу и API (первый раз — несколько минут)...' -ForegroundColor Cyan
& docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host 'Жду готовности API...' -NoNewline
for ($i = 0; $i -lt 60; $i++) {
  try { if ((Invoke-WebRequest -UseBasicParsing "http://localhost:8080/healthz" -TimeoutSec 2).StatusCode -eq 200) { break } } catch {}
  Write-Host '.' -NoNewline; Start-Sleep 2
}
Write-Host ''

$seeded = Join-Path $root 'infra\.seeded'
if (-not (Test-Path $seeded)) {
  Write-Host 'Загружаю демо-данные...' -ForegroundColor Cyan
  & docker @compose --profile demo run --rm seed
  if ($LASTEXITCODE -eq 0) { New-Item -ItemType File $seeded | Out-Null }
}

Set-Location (Join-Path $root 'mobile')
if (-not (Test-Path 'node_modules')) {
  Write-Host 'Устанавливаю зависимости приложения...' -ForegroundColor Cyan
  npm install
}
Write-Host ''
Write-Host 'Готово. Вход:  buyer@demo.artista / demo12345   художник: marina@demo.artista / demo12345' -ForegroundColor Green
Write-Host 'Сейчас запустится Expo:' -ForegroundColor Green
Write-Host '  - телефон: отсканируйте QR-код в Expo Go (телефон и компьютер в одной Wi-Fi сети)'
Write-Host '  - Android-эмулятор: нажмите a        - браузер: нажмите w'
Write-Host 'Остановить API потом:  docker compose -f infra\docker-compose.yml down'
$env:EXPO_PUBLIC_API_URL = $api
npx expo start
