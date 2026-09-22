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

    # ErrorActionPreference=Continue em volta: no Windows PowerShell 5.1,
    # stderr de comando nativo com 2>&1 vira erro TERMINANTE sob Stop -- e a
    # mensagem crua do pg_restore substituia o diagnostico claro abaixo.
    # Justamente no caso que mais importa: o dump corrompido.
    $erroAntes = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try { $indice = & $PgRestorePath --list $ArchivePath 2>&1 }
    finally { $ErrorActionPreference = $erroAntes }
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

    $erroSecundario = $null
    if ($SecondaryDir) {
        # Copia fora da maquina (pendrive, HD externo, outro disco). O
        # backup local protege contra erro humano e migration ruim, mas NAO
        # contra o disco morrer -- pra isso a copia precisa sair daqui.
        try {
            New-Item -ItemType Directory -Path $SecondaryDir -Force | Out-Null
            $alvo = Join-Path $SecondaryDir $nomeFinal
            Copy-Item -Path $destinoFinal -Destination $alvo -Force
            # Conferir o TAMANHO depois de copiar: Copy-Item nao reclama de
            # copia truncada por disco cheio ou pendrive arrancado no meio,
            # e um arquivo pela metade la fora e pior que arquivo nenhum --
            # da a sensacao de ter copia.
            $copiado = (Get-Item $alvo).Length
            $original = (Get-Item $destinoFinal).Length
            if ($copiado -ne $original) {
                throw "copia saiu com $copiado bytes contra $original do original"
            }
            Write-Host "  Copia secundaria gravada em $SecondaryDir."
        } catch {
            # Nao derruba o backup local por causa da copia: um pendrive
            # desconectado nao pode significar "hoje nao teve backup".
            # Mas TAMBEM nao pode sumir num Warning que ninguem le: a
            # tarefa roda por SYSTEM, de madrugada, sem ninguem olhando. O
            # erro vai pro estado e a loja ve na tela.
            $erroSecundario = $_.Exception.Message
            Write-Warning "Copia secundaria falhou ($erroSecundario) -- o backup local esta salvo."
        }
    }

    Remove-OldBackups -BackupDir $BackupDir -RetentionDays $RetentionDays -MinimoMantido $MinimoMantido
    Save-BackupState -BackupDir $BackupDir -ArchivePath $destinoFinal `
        -SecondaryDir $SecondaryDir -SecondaryError $erroSecundario

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
        [Parameter(Mandatory)][string]$ArchivePath,
        [string]$SecondaryDir,
        [string]$SecondaryError
    )

    $arquivoEstado = Join-Path $BackupDir "last-backup.json"

    # O ultimo SUCESSO da copia externa sobrevive a uma falha de hoje: sem
    # isso o app nao teria como dizer ha quantos dias a copia nao sai, que
    # e exatamente a informacao que transforma um aviso em urgencia.
    $ultimoOkSecundario = $null
    if (Test-Path $arquivoEstado) {
        try {
            $anterior = Get-Content $arquivoEstado -Raw | ConvertFrom-Json
            if ($anterior.PSObject.Properties.Name -contains "secondary" -and $anterior.secondary) {
                $ultimoOkSecundario = $anterior.secondary.lastOkAt
            }
        } catch {
            # Estado anterior ilegivel nao pode derrubar o backup de hoje.
            $ultimoOkSecundario = $null
        }
    }
    if ($SecondaryDir -and -not $SecondaryError) {
        $ultimoOkSecundario = (Get-Date).ToString("o")
    }

    $estado = [ordered]@{
        lastBackupAt = (Get-Date).ToString("o")
        file         = Split-Path $ArchivePath -Leaf
        sizeBytes    = (Get-Item $ArchivePath).Length
    }
    if ($SecondaryDir) {
        $estado.secondary = [ordered]@{
            dir      = $SecondaryDir
            ok       = (-not $SecondaryError)
            lastOkAt = $ultimoOkSecundario
            error    = $SecondaryError
        }
    }
    # WriteAllText com UTF8Encoding($false), nao Set-Content -Encoding UTF8:
    # no Windows PowerShell 5.1 (que e o que a tarefa agendada roda) esse
    # -Encoding UTF8 grava BOM, e JSON.parse do Node LANCA com BOM no
    # inicio. O app leria este arquivo, falharia no parse e concluiria "nunca
    # houve backup" numa loja com backup em dia -- um alarme falso que
    # ensinaria todo mundo a ignorar o alarme de verdade.
    # -Depth 3: o padrao do ConvertTo-Json e 2, e o objeto aninhado
    # "secondary" sairia como a string literal "System.Collections...".
    $json = $estado | ConvertTo-Json -Depth 3
    [IO.File]::WriteAllText(
        $arquivoEstado,
        $json,
        (New-Object System.Text.UTF8Encoding($false))
    )
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

function Invoke-RestoreRehearsal {
    <#
        ENSAIO de restauracao -- restaura o dump de verdade, num schema
        descartavel do proprio banco, dentro de uma transacao que termina em
        ROLLBACK. Cria tabela, indice, constraint e carrega os dados; nada
        fica.

        POR QUE ASSIM, E NAO NUM BANCO NOVO

        O ensaio "certo" seria restaurar num banco separado -- e exige
        CREATE DATABASE, que so superusuario do Postgres faz. A role do app
        (gestao_app) nao tem CREATEDB. Ou seja: o ensaio documentado era
        justamente o que a pessoa mais propensa a fazer o ensaio NAO
        consegue rodar, e por isso ninguem nunca rodou. Este caminho nao
        precisa de superusuario nenhum.

        O QUE ESTE ENSAIO NAO COBRE, e fica dito em vez de subentendido:
        CREATE DATABASE, dono e privilegios do banco novo, e a extensao
        pg_trgm (ja instalada e compartilhada entre schemas).

        Nao retorna valor: a saida do psql (contagens e divergencias) e o
        resultado, e quem chama nao pode engolir isso. Falha vira erro.
    #>
    param(
        [Parameter(Mandatory)][string]$PgRestorePath,
        [Parameter(Mandatory)][string]$PsqlPath,
        [Parameter(Mandatory)][string]$ArchivePath,
        [Parameter(Mandatory)][hashtable]$Connection,
        [string]$Schema = "ensaio_restore"
    )

    $temp = Join-Path ([IO.Path]::GetTempPath()) ("ensaio_{0}" -f ([guid]::NewGuid().ToString("N")))
    New-Item -ItemType Directory -Path $temp | Out-Null
    $sqlBruto = Join-Path $temp "dump.sql"
    $sqlEnsaio = Join-Path $temp "ensaio.sql"

    try {
        # 1. dump binario -> SQL legivel. --no-owner/--no-privileges porque o
        #    ensaio nao recria donos; quem roda e o dono do schema novo.
        & $PgRestorePath --no-owner --no-privileges -f $sqlBruto $ArchivePath
        if ($LASTEXITCODE -ne 0) { throw "pg_restore nao converteu o dump (codigo $LASTEXITCODE)." }

        # 2. reescreve `public.` para o schema de ensaio -- FORA dos blocos de
        #    COPY, senao um dado que contenha "public." seria corrompido.
        $saida = New-Object System.Collections.Generic.List[string]
        $saida.Add("\set ON_ERROR_STOP on")
        $saida.Add("BEGIN;")
        # Sem isto o DROP SCHEMA IF EXISTS emite um NOTICE em stderr -- e no
        # Windows PowerShell 5.1 (o que o lojista usa) stderr de comando
        # nativo vira erro TERMINANTE com ErrorActionPreference=Stop. O
        # ensaio abortava por causa de um aviso inofensivo.
        $saida.Add("SET client_min_messages = warning;")
        $saida.Add("DROP SCHEMA IF EXISTS $Schema CASCADE;")
        $saida.Add("CREATE SCHEMA $Schema;")
        # Os 40 setval do dump sao SELECT e devolvem linha: -q nao cala isso.
        # A saida do CORPO vai pro nulo; erro continua indo pra stderr, e a
        # conferencia volta pra tela logo abaixo.
        $saida.Add("\o nul")

        $dentroCopy = $false
        foreach ($linha in [IO.File]::ReadLines($sqlBruto)) {
            if ($dentroCopy) {
                $saida.Add($linha)
                if ($linha -eq "\.") { $dentroCopy = $false }
                continue
            }
            # Meta-comandos de psql e a extensao (ja existe; recriar pediria
            # superusuario e nao faz parte do que se quer provar).
            if ($linha -match '^\\(un)?restrict') { continue }
            if ($linha -match '^(CREATE EXTENSION|COMMENT ON EXTENSION)') { continue }

            # gin_trgm_ops pertence a EXTENSAO, nao ao schema restaurado:
            # reescrever faria o CREATE INDEX procurar algo que nao existe.
            $l = $linha -replace '\bpublic\.(gin_trgm_ops|gist_trgm_ops)\b', '__KEEP__$1'
            $l = $l -replace '\bpublic\.', "$Schema."
            $l = $l -replace '__KEEP__', 'public.'
            $saida.Add($l)
            if ($l -match '^COPY .* FROM stdin;$') { $dentroCopy = $true }
        }

        $saida.Add("\o")
        $saida.Add("\echo '--- conferencia ---'")
        $saida.Add("\pset pager off")
        $saida.Add("SELECT (SELECT count(*) FROM pg_tables WHERE schemaname = '$Schema') AS tabelas,")
        $saida.Add("       (SELECT count(*) FROM pg_indexes WHERE schemaname = '$Schema') AS indices,")
        $saida.Add("       (SELECT count(*) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace")
        $saida.Add("          WHERE n.nspname = '$Schema') AS constraints;")
        # Linha a linha, restaurado contra producao: prova que o dado entrou,
        # nao so que a tabela foi criada.
        $saida.Add("SELECT c.relname AS tabela,")
        $saida.Add("       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from $Schema.%I', c.relname), false, true, '')))[1]::text::bigint AS restaurado,")
        $saida.Add("       (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint AS producao")
        $saida.Add("  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace")
        $saida.Add(" WHERE n.nspname = '$Schema' AND c.relkind = 'r'")
        $saida.Add("   AND (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from $Schema.%I', c.relname), false, true, '')))[1]::text::bigint")
        $saida.Add("    <> (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', c.relname), false, true, '')))[1]::text::bigint")
        $saida.Add(" ORDER BY 1;")
        $saida.Add("ROLLBACK;")

        # SEM BOM: psql le o arquivo como UTF-8 puro e um BOM viraria lixo na
        # primeira linha. Mesma armadilha do last-backup.json.
        [IO.File]::WriteAllLines($sqlEnsaio, $saida, (New-Object System.Text.UTF8Encoding($false)))

        $env:PGPASSWORD = $Connection.Password
        $erroAntes = $ErrorActionPreference
        try {
            # stderr do psql e informacao, nao sentenca: quem decide se o
            # ensaio passou e o codigo de saida. Sem isto, um aviso qualquer
            # do Postgres abortaria antes de a conferencia ser impressa.
            $ErrorActionPreference = "Continue"
            # -q: sem isto saem 600 linhas de CREATE/ALTER TABLE e a
            # conferencia -- a unica parte que alguem precisa ler -- fica
            # enterrada. Erro continua aparecendo.
            # Capturado e reemitido linha a linha: PowerShell mistura a saida
            # nativa com Write-Host fora de ordem, e o laudo do ensaio
            # apareceria DEPOIS do "concluido" -- veredito antes da prova.
            $saidaPsql = & $PsqlPath -U $Connection.Role -h $Connection.PgHost -p $Connection.Port `
                -d $Connection.Database -v ON_ERROR_STOP=1 -q --no-password -f $sqlEnsaio 2>&1
            $codigo = $LASTEXITCODE
            $saidaPsql | ForEach-Object { Write-Host $_ }
        } finally {
            $ErrorActionPreference = $erroAntes
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        }

        if ($codigo -ne 0) {
            throw "ENSAIO FALHOU (psql codigo $codigo). Este backup nao restaura -- veja as mensagens acima."
        }
    } finally {
        Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue
    }
}
