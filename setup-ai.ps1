# 다른 PC에서 'AI 추천 이유'를 켜는 설정 스크립트 (Windows, Ollama 설치 필요)
# 하는 일: ① 사이트 접근 허용(OLLAMA_ORIGINS) ② Ollama 다시 시작 ③ 모델 내려받기 ④ 사이트 열기
# 사용법: powershell -ExecutionPolicy Bypass -File setup-ai.ps1
param(
  [string]$Origin = 'https://pikidle.github.io',
  [string]$SiteUrl = 'https://pikidle.github.io/Looks-are-everything/',
  [string]$Model = 'exaone3.5:2.4b',
  [switch]$NoOpen
)

$ollama = (Get-Command ollama -ErrorAction SilentlyContinue).Source
if (-not $ollama) { $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe" }
if (-not (Test-Path $ollama)) {
  Write-Host 'Ollama를 찾을 수 없어요. https://ollama.com 에서 설치한 뒤 다시 실행해 주세요.' -ForegroundColor Red
  exit 1
}

Write-Host '[1/4] 사이트 접근 허용 설정'
# 기존에 허용해 둔 주소가 있으면 지우지 않고 뒤에 덧붙인다.
$current = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
if (($current -split ',') -notcontains $Origin) {
  $updated = if ($current) { "$current,$Origin" } else { $Origin }
  [Environment]::SetEnvironmentVariable('OLLAMA_ORIGINS', $updated, 'User')
}
$env:OLLAMA_ORIGINS = [Environment]::GetEnvironmentVariable('OLLAMA_ORIGINS', 'User')
Write-Host "      OLLAMA_ORIGINS = $env:OLLAMA_ORIGINS"

Write-Host '[2/4] Ollama 다시 시작 (설정을 적용하려면 필요해요)'
Get-Process -Name 'ollama app', 'ollama' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
$app = Join-Path (Split-Path $ollama) 'ollama app.exe'
# 탐색기를 거쳐 실행해야 이 스크립트가 끝나도 Ollama가 계속 실행된다. 첫 시작은 30초 가까이 걸릴 수 있다.
if (Test-Path $app) { explorer.exe $app } else { Start-Process $ollama -ArgumentList 'serve' -WindowStyle Hidden }
$ready = $false
# localhost 대신 127.0.0.1: PowerShell 5.1은 IPv6(::1)부터 시도하다 시간을 다 써 버린다.
foreach ($i in 1..30) {
  try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:11434/api/version -TimeoutSec 3 | Out-Null; $ready = $true; break } catch { Start-Sleep -Seconds 2 }
}
if (-not $ready) {
  Write-Host 'Ollama가 시작되지 않았어요. 작업 표시줄에서 Ollama를 직접 실행한 뒤 다시 시도해 주세요.' -ForegroundColor Red
  exit 1
}

Write-Host "[3/4] 모델 내려받기: $Model (처음이면 약 1.6GB)"
& $ollama pull $Model
if ($LASTEXITCODE -ne 0) {
  Write-Host '모델을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.' -ForegroundColor Red
  exit 1
}

Write-Host '[4/4] 완료! Chrome이나 Edge로 사이트를 열어 주세요.' -ForegroundColor Green
Write-Host "      $SiteUrl"
Write-Host '      브라우저가 "로컬 네트워크 기기 접근" 권한을 물으면 [허용]을 눌러 주세요.'
if (-not $NoOpen) { Start-Process $SiteUrl }
