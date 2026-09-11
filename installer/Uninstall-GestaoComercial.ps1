<#
.SYNOPSIS
    Remove o servico e os arquivos do app. Por padrao NUNCA apaga o banco de
    dados nem as variaveis de ambiente com os segredos -- so com -RemoveData
    explicito, porque desfazer isso sem querer significa perder as vendas do
    cliente.
#>
[CmdletBinding()]
param(
    [string]$InstallDir = "C:\Apps\GestaoComercial",
    [switch]$RemoveData
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

Write-Host "Parando e removendo o servico..."
Remove-AppService -NssmPath "C:\ProgramData\GestaoComercial\nssm.exe"

Get-NetFirewallRule -DisplayName "Gestao Comercial - PDV (LAN)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule
Get-NetFirewallRule -DisplayName "Gestao Comercial - PDV (Tailscale)" -ErrorAction SilentlyContinue | Remove-NetFirewallRule

if (Test-Path $InstallDir) {
    Write-Host "Removendo arquivos do app em $InstallDir..."
    Remove-Item $InstallDir -Recurse -Force
}

if ($RemoveData) {
    Write-Host "AVISO: -RemoveData foi passado -- apagando variaveis de ambiente e o marcador de instalacao." -ForegroundColor Yellow
    Write-Host "O BANCO DE DADOS EM SI (Postgres) NAO e apagado por este script -- remova manualmente se for isso mesmo que voce quer." -ForegroundColor Yellow
    foreach ($name in @("DATABASE_URL", "VITE_AUTH_ENABLED", "BETTER_AUTH_SECRET", "EXTRA_AUTH_HOSTS", "HOST", "PORT")) {
        Set-MachineEnvVar -Name $name -Value $null
        [Environment]::SetEnvironmentVariable($name, $null, "Machine")
    }
    Remove-Item "C:\ProgramData\GestaoComercial" -Recurse -Force -ErrorAction SilentlyContinue
} else {
    Write-Host ""
    Write-Host "Banco de dados, segredos e marcador de instalacao foram MANTIDOS (padrao seguro)." -ForegroundColor Green
    Write-Host "Rode com -RemoveData se quiser apagar tambem a configuracao (o banco em si continua intacto)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Desinstalacao concluida." -ForegroundColor Green
