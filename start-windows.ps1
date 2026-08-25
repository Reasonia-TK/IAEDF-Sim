# BKM IEDF/IADF Simulator をWindowsでネイティブ起動する（Docker不要）
# 使い方:  .\start-windows.ps1 -Port 8010 -AdminPassword "secret" -MaxWorkers 2
param(
    [int]$Port = 8000,
    [string]$AdminPassword = "",
    [int]$MaxWorkers = 2
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$venv = Join-Path $root ".venv"
$python = Join-Path $venv "Scripts\python.exe"

if (-not (Test-Path $python)) {
    Write-Host "仮想環境を作成しています ($venv)..."
    $launcher = Get-Command py -ErrorAction SilentlyContinue
    if ($launcher) { & py -3.12 -m venv $venv } else { & python -m venv $venv }
    if (-not (Test-Path $python)) {
        throw "Python仮想環境の作成に失敗しました。Python 3.12をインストールしてください。"
    }
}

Write-Host "依存パッケージを確認しています..."
& $python -m pip install --quiet --disable-pip-version-check `
    -r (Join-Path $root "backend\requirements.txt")

if (-not $AdminPassword) {
    Write-Warning "AdminPassword未指定のため、削除などの管理操作は無効になります。"
}
$env:BKM_ADMIN_PASSWORD = $AdminPassword
$env:BKM_MAX_WORKERS = "$MaxWorkers"

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "起動します: http://localhost:$Port/"
if ($ip) { Write-Host "LAN内からは: http://${ip}:$Port/" }
Write-Host "LAN公開にはWindowsファイアウォールでポート$Port の受信許可が必要な場合があります。"
Write-Host "停止は Ctrl+C"
Write-Host ""

Set-Location (Join-Path $root "backend")
& $python -m uvicorn api.main:app --host 0.0.0.0 --port $Port
