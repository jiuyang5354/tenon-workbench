param(
  [int]$Port = 4177,
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host ""
Write-Host "  CONDUIT // Gemini x Codex Orchestration Studio" -ForegroundColor Cyan
Write-Host "  Local URL: http://127.0.0.1:$Port" -ForegroundColor White
Write-Host ""

$env:PORT = "$Port"
$env:HOST = "127.0.0.1"

if (-not $NoBrowser) {
  Start-Job -ScriptBlock {
    param($p)
    Start-Sleep -Milliseconds 1200
    Start-Process "http://127.0.0.1:$p"
  } -ArgumentList $Port | Out-Null
}

node "$Root\server.mjs"
