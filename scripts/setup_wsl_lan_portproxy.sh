#!/usr/bin/env bash
set -euo pipefail

# Configure Windows portproxy/firewall from WSL so LAN devices can reach:
# - client: 5173
# - server websocket: 2567
#
# Usage:
#   ./scripts/setup_wsl_lan_portproxy.sh

if ! grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
  echo "This script is intended to run inside WSL."
  exit 1
fi

if ! command -v powershell.exe >/dev/null 2>&1; then
  echo "powershell.exe not found. Run this from WSL on Windows."
  exit 1
fi

WSL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [[ -z "${WSL_IP}" ]]; then
  WSL_IP="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i==\"src\") {print $(i+1); exit}}')"
fi

if [[ -z "${WSL_IP}" ]]; then
  echo "Could not resolve WSL IPv4 address."
  exit 1
fi

TMP_PS="$(mktemp /tmp/hra-portproxy-XXXXXX.ps1)"
cleanup() {
  rm -f "${TMP_PS}"
}
trap cleanup EXIT

cat > "${TMP_PS}" <<'POWERSHELL'
param(
  [Parameter(Mandatory = $true)][string]$WslIp,
  [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = "Stop"
$Ports = @(5173, 2567)

function Test-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($id)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsLanIp {
  $candidate = Get-NetRoute -DestinationPrefix "0.0.0.0/0" |
    Sort-Object RouteMetric, InterfaceMetric |
    ForEach-Object {
      Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue
    } |
    Where-Object {
      $_.IPAddress -and
      $_.IPAddress -ne "127.0.0.1" -and
      $_.IPAddress -notlike "169.254.*"
    } |
    Select-Object -ExpandProperty IPAddress -First 1

  if ($candidate) {
    return $candidate
  }

  return (
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object {
        $_.IPAddress -and
        $_.IPAddress -ne "127.0.0.1" -and
        $_.IPAddress -notlike "169.254.*" -and
        $_.InterfaceAlias -notmatch "vEthernet|WSL|Hyper-V|VirtualBox|Loopback|Docker"
      } |
      Select-Object -ExpandProperty IPAddress -First 1
  )
}

if (-not (Test-Admin)) {
  $args = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", "`"$PSCommandPath`"",
    "-WslIp", "`"$WslIp`"",
    "-OutFile", "`"$OutFile`""
  )

  Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList $args | Out-Null
  if (Test-Path -LiteralPath $OutFile) {
    Get-Content -LiteralPath $OutFile
  } else {
    Write-Host "[warn] Setup finished but output file was not found: $OutFile"
  }
  exit 0
}

foreach ($port in $Ports) {
  & netsh interface portproxy delete v4tov4 listenaddress=0.0.0.0 listenport=$port | Out-Null
  & netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=$port connectaddress=$WslIp connectport=$port

  $ruleName = "HRA-WSL-PortProxy-$port"
  & netsh advfirewall firewall delete rule name="$ruleName" | Out-Null
  & netsh advfirewall firewall add rule name="$ruleName" dir=in action=allow protocol=TCP localport=$port
}

$winLanIp = Get-WindowsLanIp
if (-not $winLanIp) {
  $winLanIp = "127.0.0.1"
}

$lines = @(
  "[ok] Portproxy configured to WSL IP $WslIp for ports: $($Ports -join ', ')",
  "[ok] Share this URL with students: http://$winLanIp`:5173",
  "[ok] Game websocket is expected at: ws://$winLanIp`:2567",
  "",
  "Check active portproxy rules:",
  "  netsh interface portproxy show v4tov4"
)

$lines | Set-Content -LiteralPath $OutFile -Encoding UTF8
$lines | ForEach-Object { Write-Host $_ }
POWERSHELL

OUT_TXT="$(mktemp /tmp/hra-portproxy-out-XXXXXX.txt)"
trap 'rm -f "${TMP_PS}" "${OUT_TXT}"' EXIT

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(wslpath -w "${TMP_PS}")" -WslIp "${WSL_IP}" -OutFile "$(wslpath -w "${OUT_TXT}")"
