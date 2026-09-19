<#
    Backup do banco da loja.

    A instalacao roda num Postgres local, numa unica maquina. Ate aqui nao
    havia copia nenhuma: um disco que falha, um delete errado ou uma
    migration ruim levavam junto vendas, clientes, financeiro e caixa --
    sem volta. Este modulo existe pra fechar isso.

    Duas decisoes que valem explicar:

    1. TODO backup e VERIFICADO antes de virar backup. O dump e escrito com
       extensao ".partial" e so recebe o nome definitivo depois que o
       pg_restore consegue ler o indice do arquivo E as tabelas criticas
       aparecem nele. Backup corrompido e pior que backup nenhum: da a
       sensacao de estar protegido ate o dia em que precisa.

    2. A senha sai da DATABASE_URL de Maquina, nao de uma copia nova. O
       instalador ja guarda a credencial dedicada do app ali; criar um
       segundo lugar com a mesma senha so aumentaria a superficie sem
       ganhar nada.
#>

# Tabelas que precisam estar no indice do dump pra ele ser considerado
# valido. Nao e a lista toda de proposito -- sao as que carregam o dinheiro
# e a identidade da loja. Um dump que perdeu "sales" nao e um dump.
$script:TabelasCriticas = @(
    "sales", "sale_items", "payments", "products", "customers",
    "companies", "memberships", "cash_registers", "cash_movements", "audit_logs"
)

function Get-AppDbConnection {
    <#
        Desmonta a DATABASE_URL (de Maquina, por padrao) nos pedacos que o
        pg_dump/pg_restore precisam.
    #>
    param([string]$ConnectionString)

    if (-not $ConnectionString) {
        $ConnectionString = [Environment]::GetEnvironmentVariable("DATABASE_URL", "Machine")
    }
    if (-not $ConnectionString) {
        throw "DATABASE_URL nao encontrada no escopo de Maquina -- o app foi instalado nesta maquina?"
    }

    $uri = [Uri]$ConnectionString
    $userInfo = $uri.UserInfo -split ":", 2
    if ($userInfo.Count -lt 2) {
        throw "DATABASE_URL sem usuario/senha -- formato inesperado."
    }

    return @{
        PgHost   = $uri.Host
        Port     = if ($uri.Port -gt 0) { $uri.Port } else { 5432 }
        Database = [Uri]::UnescapeDataString($uri.AbsolutePath.TrimStart("/"))
        Role     = [Uri]::UnescapeDataString($userInfo[0])
        Password = [Uri]::UnescapeDataString($userInfo[1])
    }
}

function Test-BackupArchive {
    <#
        Le o indice do dump SEM tocar em banco nenhum (pg_restore --list so
        abre o arquivo). Prova tres coisas de uma vez: o arquivo nao foi
        truncado, o formato esta integro, e as tabelas criticas estao la.

        Retorna a contagem de entradas de dados encontradas.
    #>
    param(
        [Parameter(Mandatory)][string]$PgRestorePath,
        [Parameter(Mandatory)][string]$ArchivePath
    )

    $tamanho = (Get-Item $ArchivePath).Length
    if ($tamanho -lt 1024) {
        throw "Dump gerado com apenas $tamanho bytes -- arquivo vazio ou truncado."
    }

    $indice = & $PgRestorePath --list $ArchivePath 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "pg_restore nao conseguiu ler o dump (codigo $LASTEXITCODE): $($indice | Select-Object -Last 3)"
    }

    $texto = $indice -join [Environment]::NewLine
    $faltando = @($script:TabelasCriticas | Where-Object {
        $texto -notmatch ("TABLE DATA public " + [regex]::Escape($_) + "\b")
    })
    if ($faltando.Count -gt 0) {
        throw "Dump nao contem as tabelas criticas: $($faltando -join ', ')."
    }

    return @($indice | Where-Object { $_ -match "TABLE DATA" }).Count
}

function Invoke-AppBackup {
    <#
        Gera, verifica e publica um backup. Devolve o caminho final.
    #>
    param(
        [Parameter(Mandatory)][string]$PgDumpPath,
        [Parameter(Mandatory)][string]$PgRestorePath,
        [Parameter(Mandatory)][hashtable]$Connection,
        [Parameter(Mandatory)][string]$BackupDir,
        [string]$SecondaryDir,
        [int]$RetentionDays = 30,
        [int]$MinimoMantido = 7
    )

    New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null

    $carimbo = Get-Date -Format "yyyyMMdd_HHmmss"
    $nomeFinal = "gestao_comercial_$carimbo.dump"
    $destinoFinal = Join-Path $BackupDir $nomeFinal
    # Nome provisorio ate passar na verificacao: um arquivo pela metade
    # nunca pode ficar com cara de backup bom, senao a retencao pode apagar
    # um backup integro e manter o quebrado.
    $destinoParcial = "$destinoFinal.partial"

    $env:PGPASSWORD = $Connection.Password
    try {
        # -Fc = formato custom: comprimido e restauravel seletivamente (da
        # pra recuperar UMA tabela sem derrubar o resto do banco).
        & $PgDumpPath -U $Connection.Role -h $Connection.PgHost -p $Connection.Port `
            -d $Connection.Database -Fc --no-password -f $destinoParcial
        if ($LASTEXITCODE -ne 0) {
            throw "pg_dump falhou com codigo $LASTEXITCODE."
        }
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }

    $tabelas = Test-BackupArchive -PgRestorePath $PgRestorePath -ArchivePath $destinoParcial

    Move-Item -Path $destinoParcial -Destination $destinoFinal -Force
    $tamanhoMb = [math]::Round((Get-Item $destinoFinal).Length / 1MB, 2)
    Write-Host "  Backup verificado: $nomeFinal ($tamanhoMb MB, $tabelas tabelas)."

    if ($SecondaryDir) {
        # Copia fora da maquina (pendrive, HD externo, pasta de rede). O
        # backup local protege contra erro humano e migration ruim, mas NAO
        # contra o disco morrer -- pra isso a copia precisa sair daqui.
        try {
            New-Item -ItemType Directory -Path $SecondaryDir -Force | Out-Null
            Copy-Item -Path $destinoFinal -Destination (Join-Path $SecondaryDir $nomeFinal) -Force
            Write-Host "  Copia secundaria gravada em $SecondaryDir."
        } catch {
            # Nao derruba o backup local por causa da copia: um pendrive
            # desconectado nao pode significar "hoje nao teve backup".
            Write-Warning "Copia secundaria falhou ($($_.Exception.Message)) -- o backup local esta salvo."
        }
    }

    Remove-OldBackups -BackupDir $BackupDir -RetentionDays $RetentionDays -MinimoMantido $MinimoMantido
    Save-BackupState -BackupDir $BackupDir -ArchivePath $destinoFinal

    return $destinoFinal
}

function Remove-OldBackups {
    <#
        Retencao por idade, com piso por quantidade: mesmo que a loja fique
        um mes fechada e todos os backups envelhecam, os $MinimoMantido mais
        novos ficam. O filtro de nome e estrito de proposito -- esta funcao
        so pode apagar arquivo que ELA gerou.
    #>
    param(
        [Parameter(Mandatory)][string]$BackupDir,
        [int]$RetentionDays = 30,
        [int]$MinimoMantido = 7
    )

    $todos = @(Get-ChildItem -Path $BackupDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -match "^gestao_comercial_\d{8}_\d{6}\.dump$" } |
        Sort-Object LastWriteTime -Descending)

    if ($todos.Count -le $MinimoMantido) { return }

    $limite = (Get-Date).AddDays(-$RetentionDays)
    $candidatos = @($todos | Select-Object -Skip $MinimoMantido |
        Where-Object { $_.LastWriteTime -lt $limite })
    foreach ($arquivo in $candidatos) {
        Remove-Item $arquivo.FullName -Force
        Write-Host "  Backup antigo removido: $($arquivo.Name)."
    }

    # Restos de tentativas interrompidas nao viram backup nem ocupam disco
    # pra sempre.
    Get-ChildItem -Path $BackupDir -File -Filter "*.partial" -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-1) } |
        ForEach-Object { Remove-Item $_.FullName -Force }
}

function Save-BackupState {
    <#
        Marca quando foi o ultimo backup BOM. Existe pra tornar visivel a
        falha mais traicoeira deste tipo de rotina: a que para de rodar e
        ninguem percebe, porque "nao dar erro" e exatamente como o silencio
        se parece.
    #>
    param(
        [Parameter(Mandatory)][string]$BackupDir,
        [Parameter(Mandatory)][string]$ArchivePath
    )

    $estado = [ordered]@{
        lastBackupAt = (Get-Date).ToString("o")
        file         = Split-Path $ArchivePath -Leaf
        sizeBytes    = (Get-Item $ArchivePath).Length
    }
    $estado | ConvertTo-Json | Set-Content -Path (Join-Path $BackupDir "last-backup.json") -Encoding UTF8
}

function Register-AppBackupTask {
    <#
        Agenda o backup diario como tarefa do Windows rodando por SYSTEM
        (que enxerga a DATABASE_URL de Maquina e nao depende de ninguem
        estar logado no balcao).

        -StartWhenAvailable importa numa loja de verdade: a maquina costuma
        ficar desligada fora do horario comercial, e sem isso a execucao
        perdida simplesmente nao acontece -- o backup "diario" viraria
        "quando calhar de estar ligado as 22h30".
    #>
    param(
        [Parameter(Mandatory)][string]$ScriptPath,
        [string]$TaskName = "GestaoComercial-Backup",
        [string]$Horario = "22:30",
        [string]$SecondaryDir
    )

    $argumentos = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$ScriptPath`""
    if ($SecondaryDir) {
        $argumentos += " -SecondaryDir `"$SecondaryDir`""
    }

    $acao = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentos
    $gatilho = New-ScheduledTaskTrigger -Daily -At $Horario
    $principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    $config = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2) `
        -MultipleInstances IgnoreNew

    Register-ScheduledTask -TaskName $TaskName -Action $acao -Trigger $gatilho `
        -Principal $principal -Settings $config -Force | Out-Null

    Write-Host "  Backup diario agendado para as $Horario (tarefa '$TaskName')."
}
