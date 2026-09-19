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
    [switch]$RemoveData,
    # Os backups sao a ULTIMA copia dos dados da loja. -RemoveData apaga
    # configuracao, e este script promete nao apagar o banco -- apagar os
    # backups junto contradiria essa promessa no pior momento possivel.
    # Entao eles so somem se forem pedidos por nome.
    [switch]$RemoveBackups
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

Write-Host "Removendo a tarefa de backup diario..."
Unregister-ScheduledTask -TaskName "GestaoComercial-Backup" -Confirm:$false -ErrorAction SilentlyContinue

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
        # [Environment]::SetEnvironmentVariable direto, nao Set-MachineEnvVar --
        # essa funcao exige um $Value string obrigatorio (nem aceita $null),
        # entao chama-la aqui quebraria o -RemoveData inteiro com erro de
        # parametro antes de apagar qualquer coisa. $null e o jeito certo de
        # REMOVER uma variavel de ambiente (nao so deixar vazia).
        [Environment]::SetEnvironmentVariable($name, $null, "Machine")
    }
    $stateDir = "C:\ProgramData\GestaoComercial"
    $backupDir = Join-Path $stateDir "backups"
    $backupsPreservados = $null
    if ((Test-Path $backupDir) -and -not $RemoveBackups) {
        # Tira os backups da frente ANTES do apagao recursivo e devolve
        # depois. Sem isto, -RemoveData levaria junto a ultima copia dos
        # dados da loja -- exatamente o que este script promete nao fazer.
        $backupsPreservados = Join-Path $env:TEMP ("gc-backups-" + [guid]::NewGuid().ToString("N"))
        Move-Item -Path $backupDir -Destination $backupsPreservados -Force
    }

    Remove-Item $stateDir -Recurse -Force -ErrorAction SilentlyContinue

    if ($backupsPreservados) {
        New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
        Move-Item -Path $backupsPreservados -Destination $backupDir -Force
        Write-Host ""
        Write-Host "Os backups do banco foram MANTIDOS em $backupDir." -ForegroundColor Green
        Write-Host "Rode com -RemoveBackups se quiser apagar tambem a ultima copia dos dados." -ForegroundColor Green
    }
} else {
    Write-Host ""
    Write-Host "Banco de dados, segredos e marcador de instalacao foram MANTIDOS (padrao seguro)." -ForegroundColor Green
    Write-Host "Rode com -RemoveData se quiser apagar tambem a configuracao (o banco em si continua intacto)." -ForegroundColor Green
}

Write-Host ""
Write-Host "Desinstalacao concluida." -ForegroundColor Green
