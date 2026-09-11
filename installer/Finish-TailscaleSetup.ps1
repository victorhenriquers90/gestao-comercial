<#
.SYNOPSIS
    Roda uma vez, DEPOIS que o responsavel da loja fez "tailscale login"
    manualmente. Acrescenta o IP do Tailscale ao acesso liberado do app e
    reinicia o servico (variavel de ambiente so tem efeito num processo novo).

.DESCRIPTION
    Nunca sobrescreve EXTRA_AUTH_HOSTS -- so acrescenta o IP do Tailscale ao
    que ja estiver la (o IP da LAN, configurado no install inicial).
#>
[CmdletBinding()]
param(
    [string]$TailscaleExePath = "C:\Program Files\Tailscale\tailscale.exe",
    [int]$Port
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libDir = Join-Path $PSScriptRoot "lib"
. (Join-Path $libDir "Secrets.ps1")
. (Join-Path $libDir "Network.ps1")
. (Join-Path $libDir "WindowsService.ps1")

$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Este script precisa rodar num PowerShell como Administrador."
}

if (-not (Test-Path $TailscaleExePath)) {
    throw "Tailscale nao encontrado em $TailscaleExePath. Instale o cliente e rode 'tailscale login' antes deste script."
}

if (-not $Port) {
    $Port = [int](Get-MachineEnvVar -Name "PORT")
    if (-not $Port) { $Port = 8080 }
}

$tailscaleIp = (& $TailscaleExePath ip -4 2>&1 | Select-Object -First 1).Trim()
if (-not $tailscaleIp -or $tailscaleIp -notmatch "^\d+\.\d+\.\d+\.\d+$") {
    throw "Nao foi possivel obter o IP do Tailscale -- rode 'tailscale login' primeiro e confira com '$TailscaleExePath status'."
}

Write-Host "IP do Tailscale detectado: $tailscaleIp"

Add-MachineEnvHost -Name "EXTRA_AUTH_HOSTS" -HostToAdd $tailscaleIp

$nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodeExe) { $nodeExe = "C:\Program Files\nodejs\node.exe" }
Set-ScopedFirewallRule -DisplayName "Gestao Comercial - PDV (Tailscale)" -Port $Port -ProgramPath $nodeExe `
    -Profile "Any" -RemoteAddress "100.64.0.0/10"

Write-Host "Reiniciando o servico para aplicar EXTRA_AUTH_HOSTS atualizado..."
Restart-AppService

Write-Host ""
Write-Host "Pronto. Acesso remoto liberado em: http://${tailscaleIp}:$Port" -ForegroundColor Green
