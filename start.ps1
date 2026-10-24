# Локальный запуск Artista на Windows: база + API + сайт и веб-версия (Docker), мобильное приложение (Expo).
# Запуск из корня репозитория:  powershell -ExecutionPolicy Bypass -File .\start.ps1
#   -Web  — без Expo: открыть сайт и веб-версию в браузере (то же видят пользователи из Telegram)
param([switch]$Web)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$root = $PSScriptRoot
Set-Location $root

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "Не найден $cmd. $hint" -ForegroundColor Red; exit 1 }
}
Need docker 'Установите и запустите Docker Desktop.'
if (-not $Web) { Need npm 'Установите Node.js 20+ (https://nodejs.org).' }
# docker пишет ошибку в stderr — при ErrorActionPreference=Stop это прервало бы скрипт без понятного сообщения
$prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
docker info 2>&1 | Out-Null
$dockerOk = $LASTEXITCODE -eq 0
$ErrorActionPreference = $prev
if (-not $dockerOk) {
  Write-Host 'Docker Desktop не запущен. Откройте его, дождитесь статуса «Engine running» и запустите скрипт снова.' -ForegroundColor Red
  exit 1
}

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
$ErrorActionPreference = 'Continue'  # docker compose выводит прогресс в stderr
& docker @compose up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host 'Не удалось запустить контейнеры — см. вывод выше.' -ForegroundColor Red; exit 1 }

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

if ($Web) {
  Write-Host ''
  Write-Host 'Готово. Вход:  buyer@demo.artista / demo12345   художник: marina@demo.artista / demo12345' -ForegroundColor Green
  Write-Host "  сайт:          $api/"
  Write-Host "  веб-версия:    $api/app/"
  Write-Host "  с телефона (та же Wi-Fi, можно из Telegram): $api/app/"
  Write-Host 'Остановить:  docker compose -f infra\docker-compose.yml down'
  Start-Process "http://localhost:8080/app/"
  exit 0
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
Write-Host "Сайт и веб-версия уже работают: $api/ и $api/app/"
Write-Host 'Остановить API потом:  docker compose -f infra\docker-compose.yml down'
$env:EXPO_PUBLIC_API_URL = $api
npx expo start
