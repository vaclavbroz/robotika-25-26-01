#!/usr/bin/env bash
set -euo pipefail

# Remove Windows portproxy/firewall rules configured for HRA LAN access.
#
# Usage:
#   ./scripts/remove_wsl_lan_portproxy.sh

if ! grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
  echo "This script is intended to run inside WSL."
  exit 1
fi

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe not found. Run this from WSL on Windows."
  exit 1
fi

TMP_PS="$(mktemp /tmp/hra-portproxy-remove-XXXXXX.ps1)"
OUT_TXT="$(mktemp /tmp/hra-portproxy-remove-out-XXXXXX.txt)"
cleanup() {
  rm -f "${TMP_PS}" "${OUT_TXT}"
}
trap cleanup EXIT

cat > "${TMP_PS}" <<'POWERSHELL'
param(
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"
$Ports = @(5173, 2567)

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-OutFile", "`"$OutFile`""
  )
  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList $args | Out-Null
  if (Test-Path -LiteralPath $OutFile) {
    Get-Content -LiteralPath $OutFile
  } else {
    Write-Host "[warn] Cleanup finished but output file was not found: $OutFile"
  }
  exit 0
}

foreach ($port in $Ports) {
  & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port | Out-Null
  $ruleName = "HRA-WSL-PortProxy-$port"
  & netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
}

$lines = @(
  "[ok] Removed portproxy entries and firewall rules for ports: $($Ports -join ', ')",
  "",
  "Check active portproxy rules:",
  "  netsh interface portproxy show v4tov4"
)

$lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
$lines | ForEach-Object { Write-Host $_ }
POWERSHELL

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "${TMP_PS}")" -OutFile "$(wslpath -w "${OUT_TXT}")"
