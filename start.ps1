# 사과게임 서버 + 공개 주소(Cloudflare 임시 터널)를 한 번에 켭니다.
# 사용법: start.bat 을 더블클릭하거나, 이 창에서  powershell -File start.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host ''
  Write-Host '  Node.js가 설치되어 있지 않아요. https://nodejs.org 에서 설치한 뒤 다시 실행해 주세요.' -ForegroundColor Red
  Write-Host ''
  exit 1
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
  Write-Host '  처음 실행이라 필요한 패키지를 설치합니다...' -ForegroundColor Cyan
  npm install --no-audit --no-fund
}

Write-Host ''
Write-Host '  사과게임 서버를 켜는 중...' -ForegroundColor Cyan
$server = Start-Process node -ArgumentList 'server.js' -PassThru -NoNewWindow

try {
  Start-Sleep -Seconds 1

  Write-Host ''
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor DarkGray
  Write-Host '   공개 주소를 만드는 중입니다. (처음 한 번은 다운로드로 30초쯤 걸려요)' -ForegroundColor Cyan
  Write-Host '   잠시 뒤 아래 상자 안에 나오는' -ForegroundColor Cyan
  Write-Host '     https://XXXX-XXXX.trycloudflare.com' -ForegroundColor Yellow
  Write-Host '   주소를 친구에게 보내면 됩니다. (주소 뒤에 #방코드 를 붙이면 코드가 미리 채워져요)' -ForegroundColor Cyan
  Write-Host ''
  Write-Host '   * 이 창을 닫으면 주소도 같이 사라져요. 게임하는 동안 켜두세요.' -ForegroundColor DarkGray
  Write-Host '   * 껐다 켜면 주소가 매번 바뀝니다.' -ForegroundColor DarkGray
  Write-Host '   * 내 컴퓨터에서만 할 거면 http://localhost:3000 으로 들어가면 돼요.' -ForegroundColor DarkGray
  Write-Host '  ------------------------------------------------------------------' -ForegroundColor DarkGray
  Write-Host ''

  npx --yes cloudflared tunnel --url http://localhost:3000
}
finally {
  if ($server -and -not $server.HasExited) {
    Write-Host ''
    Write-Host '  서버를 종료합니다.' -ForegroundColor DarkGray
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
