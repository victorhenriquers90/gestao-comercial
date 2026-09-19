<#
    Restauracao do banco a partir de um backup gerado por
    Backup-GestaoComercial.ps1.

    Este script SUBSTITUI dados. Ele e deliberadamente chato de disparar,
    porque o cenario em que ele e usado (loja parada, alguem nervoso) e
    exatamente o cenario em que se digita o comando errado:

    - Exige -Force E digitar o nome do banco quando o alvo e o banco real.
    - Tira um backup de seguranca ANTES de sobrescrever qualquer coisa. Se
      a restauracao for do arquivo errado, ainda da pra voltar -- sem isso,
      um erro de escolha de arquivo seria definitivo.
    - Para o servico antes e sobe depois: restaurar com o app conectado
      deixaria o sistema lendo um banco pela metade durante o processo.

    Ensaio (RECOMENDADO fazer pelo menos uma vez, com a loja tranquila):
    restaurar num banco descartavel em vez do real. Crie o banco vazio
    primeiro, como superusuario do Postgres:

        psql -U postgres -c "CREATE DATABASE ensaio_restauracao OWNER gestao_app"

    e depois rode este script com -TargetDatabase ensaio_restauracao. Nada
    do banco de producao e tocado, e voce descobre ANTES da emergencia se o
    backup presta. Backup que nunca foi restaurado e so um arquivo grande.
#>
[CmdletBinding()]
param(
    # Arquivo .dump a restaurar. Sem isto, usa o backup mais recente.
    [string]$BackupFile,
    # Banco de destino. Sem isto, usa o banco real da DATABASE_URL.
    [string]$TargetDatabase,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libDir = Join-Path $PSScriptRoot "lib"
. (Join-Path $libDir "Prerequisites.ps1")
. (Join-Path $libDir "Backup.ps1")

$StateDir = "C:\ProgramData\GestaoComercial"
$BackupDir = Join-Path $StateDir "backups"
$NssmPath = Join-Path $StateDir "nssm.exe"
$ServiceName = "GestaoComercial"

$pgDir = Get-PostgresInstallDir
if (-not $pgDir) { throw "PostgreSQL nao encontrado em C:\Program Files\PostgreSQL." }
$pgDump = Join-Path $pgDir "bin\pg_dump.exe"
$pgRestore = Join-Path $pgDir "bin\pg_restore.exe"

$conexao = Get-AppDbConnection
$bancoReal = $conexao.Database
if (-not $TargetDatabase) { $TargetDatabase = $bancoReal }
$ehBancoReal = ($TargetDatabase -eq $bancoReal)

if (-not $BackupFile) {
    $maisRecente = Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^gestao_comercial_\d{8}_\d{6}\.dump$" } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $maisRecente) { throw "Nenhum backup encontrado em $BackupDir." }
    $BackupFile = $maisRecente.FullName
}
if (-not (Test-Path $BackupFile)) { throw "Arquivo nao encontrado: $BackupFile." }

Write-Host ""
Write-Host "  Arquivo : $(Split-Path $BackupFile -Leaf)"
Write-Host "  Gerado  : $((Get-Item $BackupFile).LastWriteTime)"
Write-Host "  Tamanho : $([math]::Round((Get-Item $BackupFile).Length / 1MB, 2)) MB"
Write-Host "  Destino : $TargetDatabase$(if ($ehBancoReal) { '   <-- BANCO DE PRODUCAO' })"
Write-Host ""

# Verifica o arquivo ANTES de parar a loja: descobrir que o dump esta
# corrompido com o servico ja derrubado seria trocar um problema por dois.
Write-Host "Verificando o arquivo..."
$tabelas = Test-BackupArchive -PgRestorePath $pgRestore -ArchivePath $BackupFile
Write-Host "  Arquivo integro ($tabelas tabelas)."

if ($ehBancoReal) {
    if (-not $Force) {
        throw "Restaurar por cima do banco de producao exige -Force (e confirmacao digitada)."
    }
    Write-Host ""
    Write-Warning "Isto SUBSTITUI os dados atuais de '$bancoReal' pelos do arquivo acima."
    Write-Warning "Tudo que foi lancado na loja DEPOIS de $((Get-Item $BackupFile).LastWriteTime) se perde."
    $resposta = Read-Host "Digite o nome do banco ($bancoReal) para confirmar"
    if ($resposta -ne $bancoReal) {
        throw "Confirmacao nao confere -- nada foi alterado."
    }
}

$env:PGPASSWORD = $conexao.Password
try {
    if ($ehBancoReal) {
        # Rede de seguranca: o estado atual vira arquivo antes de sumir.
        Write-Host ""
        Write-Host "Salvando o estado atual antes de sobrescrever..."
        $antes = Join-Path $BackupDir ("pre_restauracao_{0}.dump" -f (Get-Date -Format "yyyyMMdd_HHmmss"))
        & $pgDump -U $conexao.Role -h $conexao.PgHost -p $conexao.Port -d $bancoReal -Fc --no-password -f $antes
        if ($LASTEXITCODE -ne 0) {
            throw "Nao consegui salvar o estado atual (pg_dump codigo $LASTEXITCODE) -- restauracao ABORTADA."
        }
        Write-Host "  Estado anterior salvo em $(Split-Path $antes -Leaf)."

        if (Test-Path $NssmPath) {
            Write-Host "Parando o servico $ServiceName..."
            & $NssmPath stop $ServiceName | Out-Null
        }
    }

    Write-Host ""
    Write-Host "Restaurando..."
    # --clean --if-exists derruba os objetos antigos antes de recriar; sem
    # isso a restauracao por cima de um banco povoado falha em cada chave
    # duplicada. --no-owner deixa tudo com a role que esta restaurando, o
    # que faz o ensaio num banco descartavel funcionar sem superusuario.
    & $pgRestore -U $conexao.Role -h $conexao.PgHost -p $conexao.Port `
        -d $TargetDatabase --clean --if-exists --no-owner --no-password $BackupFile
    $codigoRestore = $LASTEXITCODE
} finally {
    Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    if ($ehBancoReal -and (Test-Path $NssmPath)) {
        Write-Host "Subindo o servico $ServiceName..."
        & $NssmPath start $ServiceName | Out-Null
    }
}

Write-Host ""
if ($codigoRestore -ne 0) {
    # pg_restore devolve codigo diferente de zero tambem por avisos que nao
    # impedem a restauracao (ex.: "DROP ... nao existe" num banco vazio),
    # entao isto e um alerta pra conferir, nao uma sentenca de falha.
    Write-Warning "pg_restore terminou com codigo $codigoRestore -- confira as mensagens acima."
    Write-Warning "Avisos de DROP em banco vazio sao normais; erros em COPY/CREATE TABLE nao sao."
} else {
    Write-Host "Restauracao concluida." -ForegroundColor Green
}

if ($ehBancoReal) {
    Write-Host "Confira o sistema em http://localhost:8080 antes de liberar o balcao."
}
