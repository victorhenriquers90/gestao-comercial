<#
    Muda (ou remove) a pasta da copia de backup fora do disco do banco.

    POR QUE ISTO EXISTE SEPARADO DO INSTALADOR

    Ate aqui o unico jeito de configurar a copia externa era reinstalar com
    -BackupSecondaryDir. Trocar de pendrive, mudar a letra do HD ou passar a
    usar uma pasta de rede obrigava a rodar o instalador inteiro -- que para
    o servico, mexe em arquivos, roda migrations e tira backup. Muito risco
    pra mudar um caminho, e risco demais e o que faz a mudanca nunca ser
    feita.

    Aqui so a tarefa agendada e reescrita.

    PRECISA DE ADMINISTRADOR: a tarefa roda como SYSTEM, e so quem tem
    privilegio altera tarefa de SYSTEM. Rode num PowerShell aberto com
    "Executar como administrador":

        .\Set-BackupSecondaryDir.ps1 -SecondaryDir "D:\backups-gestao"

    Pra voltar a ter so a copia local:

        .\Set-BackupSecondaryDir.ps1 -Remover
#>
[CmdletBinding()]
param(
    # Pasta de destino da copia. Pendrive, HD externo, outro disco ou pasta
    # de rede -- o que importa e NAO ser o mesmo disco do banco.
    [string]$SecondaryDir,
    # Remove a copia externa e deixa so o backup local.
    [switch]$Remover
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Sem isto o script terminaria com codigo 0 mesmo falhando, e quem chamou
# acharia que a mudanca pegou.
trap {
    Write-Host ""
    Write-Host $($_.Exception.Message) -ForegroundColor Red
    exit 1
}

$libDir = Join-Path $PSScriptRoot "lib"
. (Join-Path $libDir "Backup.ps1")


if (-not $Remover -and -not $SecondaryDir) {
    throw "Informe -SecondaryDir `"D:\backups-gestao`" ou use -Remover."
}
if ($Remover -and $SecondaryDir) {
    throw "Use -SecondaryDir ou -Remover, nao os dois."
}

# Depois da validacao de argumentos: um erro de digitacao nao deveria
# obrigar ninguem a abrir um shell elevado pra descobrir que digitou errado.
$ehAdmin = ([Security.Principal.WindowsPrincipal] `
        [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $ehAdmin) {
    throw "Abra o PowerShell como administrador: a tarefa de backup roda como SYSTEM."
}

$StateDir = "C:\ProgramData\GestaoComercial"
$scriptBackup = Join-Path $StateDir "tools\Backup-GestaoComercial.ps1"
if (-not (Test-Path $scriptBackup)) {
    # A tarefa aponta pra copia instalada em ProgramData, nao pra esta pasta:
    # reagendar apontando pro pendrive de onde o instalador rodou faria o
    # backup parar no dia em que alguem tirasse o pendrive.
    throw "Nao encontrei $scriptBackup. Rode o instalador ao menos uma vez."
}

if ($Remover) {
    Register-AppBackupTask -ScriptPath $scriptBackup
    Write-Host ""
    Write-Host "Copia externa removida. O backup diario continua salvando em $StateDir\backups." -ForegroundColor Yellow
    Write-Host "Atencao: as copias voltam a ficar todas no mesmo disco do banco."
    return
}

# Prova que da pra ESCREVER la, agora, em vez de descobrir as 22h30 de hoje
# que o caminho nao serve. Um destino que so falha de madrugada falha em
# silencio.
$teste = Join-Path $SecondaryDir ".gestao-teste-escrita"
try {
    New-Item -ItemType Directory -Path $SecondaryDir -Force | Out-Null
    Set-Content -Path $teste -Value "ok" -ErrorAction Stop
    Remove-Item $teste -Force -ErrorAction SilentlyContinue
} catch {
    throw "Nao consigo escrever em ${SecondaryDir}: $($_.Exception.Message)"
}

# Mesmo disco do banco nao e copia de seguranca -- e a mesma pilha de ovos
# na mesma cesta com outro nome.
$raizDestino = [IO.Path]::GetPathRoot((Resolve-Path $SecondaryDir).Path)
$raizEstado = [IO.Path]::GetPathRoot($StateDir)
if ($raizDestino -eq $raizEstado) {
    Write-Warning "$SecondaryDir esta no mesmo disco ($raizEstado) do banco e dos backups locais."
    Write-Warning "Isso NAO protege contra o disco falhar. Prossiga so se for um passo intermediario."
}

Register-AppBackupTask -ScriptPath $scriptBackup -SecondaryDir $SecondaryDir

Write-Host ""
Write-Host "Copia externa configurada: $SecondaryDir" -ForegroundColor Green
Write-Host "Rode um backup agora pra confirmar de ponta a ponta:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$scriptBackup`" -SecondaryDir `"$SecondaryDir`""
Write-Host ""
Write-Host "Depois disso, a tela de Configuracoes passa a avisar se a copia parar de sair."
