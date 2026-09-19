<#
    Ponto de entrada do backup diario -- e isto que a tarefa agendada do
    Windows chama (ver Register-AppBackupTask em lib\Backup.ps1).

    Roda por SYSTEM, sem ninguem olhando. Por isso tudo vai pro
    C:\ProgramData\GestaoComercial\logs\backup.log: quando esta rotina
    falhar, o erro tem que estar escrito em algum lugar, senao a primeira
    noticia da falha seria no dia em que alguem precisasse restaurar.

    Tambem da pra rodar na mao, a qualquer momento, pra tirar um backup
    antes de algo arriscado (uma atualizacao grande, por exemplo):

        powershell -ExecutionPolicy Bypass -File Backup-GestaoComercial.ps1
#>
[CmdletBinding()]
param(
    # Copia adicional fora da maquina (pendrive, HD externo, pasta de rede).
    [string]$SecondaryDir,
    [int]$RetentionDays = 30,
    [int]$MinimoMantido = 7
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libDir = Join-Path $PSScriptRoot "lib"
. (Join-Path $libDir "Prerequisites.ps1")
. (Join-Path $libDir "Backup.ps1")

$StateDir = "C:\ProgramData\GestaoComercial"
$BackupDir = Join-Path $StateDir "backups"
$logDir = Join-Path $StateDir "logs"
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logFile = Join-Path $logDir "backup.log"

function Write-Log {
    param([string]$Mensagem)
    $linha = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Mensagem
    Write-Host $linha
    Add-Content -Path $logFile -Value $linha -Encoding UTF8
}

# O log nao pode crescer pra sempre numa maquina que fica anos rodando.
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) {
    Move-Item -Path $logFile -Destination "$logFile.old" -Force
}

try {
    Write-Log "Iniciando backup."

    $pgDir = Get-PostgresInstallDir
    if (-not $pgDir) {
        throw "PostgreSQL nao encontrado em C:\Program Files\PostgreSQL."
    }
    $pgDump = Join-Path $pgDir "bin\pg_dump.exe"
    $pgRestore = Join-Path $pgDir "bin\pg_restore.exe"
    foreach ($ferramenta in @($pgDump, $pgRestore)) {
        if (-not (Test-Path $ferramenta)) { throw "Nao encontrei $ferramenta." }
    }

    $conexao = Get-AppDbConnection
    Write-Log "Banco: $($conexao.Database) em $($conexao.PgHost):$($conexao.Port)."

    $arquivo = Invoke-AppBackup -PgDumpPath $pgDump -PgRestorePath $pgRestore `
        -Connection $conexao -BackupDir $BackupDir -SecondaryDir $SecondaryDir `
        -RetentionDays $RetentionDays -MinimoMantido $MinimoMantido

    $tamanhoMb = [math]::Round((Get-Item $arquivo).Length / 1MB, 2)
    Write-Log "OK -- $(Split-Path $arquivo -Leaf) ($tamanhoMb MB)."
    exit 0
} catch {
    Write-Log "FALHOU: $($_.Exception.Message)"
    Write-Log "Origem : $($_.InvocationInfo.PositionMessage)"
    # Codigo de saida diferente de zero pro Agendador de Tarefas registrar
    # a execucao como falha, e nao como "concluida".
    exit 1
}
