<#
    Criacao da role/banco dedicados deste app dentro de uma instancia
    Postgres existente -- NUNCA mexe em outras roles/bancos que possam
    conviver na mesma instancia (ex.: um Postgres que ja serve outro
    sistema do cliente).

    A senha do superusuario do Postgres so e conhecida por quem esta
    rodando o instalador (o Victor, ou quem ele autorizar) -- este script
    aceita como SecureString e nunca a grava em disco, log ou linha de
    comando; so vira texto puro no processo filho do psql (via variavel de
    ambiente PGPASSWORD), pelo tempo minimo necessario.
#>

function New-AppDatabaseRole {
    param(
        [Parameter(Mandatory)][string]$PsqlPath,
        [Parameter(Mandatory)][string]$RoleName,
        [Parameter(Mandatory)][string]$RolePassword,
        [Parameter(Mandatory)][string]$DatabaseName,
        [Parameter(Mandatory)][System.Security.SecureString]$SuperuserPassword,
        [string]$PgHost = "localhost",
        [int]$Port = 5432
    )
    if ($RoleName -notmatch "^[a-z_][a-z0-9_]*$") {
        throw "Nome de role invalido: $RoleName"
    }
    if ($DatabaseName -notmatch "^[a-z_][a-z0-9_]*$") {
        throw "Nome de banco invalido: $DatabaseName"
    }

    # CREATE ROLE/DATABASE nao aceitam parametros ($1, $2...) via psql simples
    # -- os nomes ja foram validados acima (so [a-z0-9_]), e a senha vai como
    # literal SQL com aspas simples escapadas (ela e gerada por New-DbPassword,
    # so alfanumerico, entao a rigor nunca teria aspas -- o escape aqui e so
    # defesa em profundidade caso a geracao mude no futuro).
    $escapedPassword = $RolePassword -replace "'", "''"
    $sql = @"
DO `$do`$
BEGIN
   IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$RoleName') THEN
      CREATE ROLE $RoleName WITH LOGIN PASSWORD '$escapedPassword';
   END IF;
END
`$do`$;
SELECT 'CREATE DATABASE $DatabaseName OWNER $RoleName'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DatabaseName')
\gexec
"@

    $plainSuperuserPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
        [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($SuperuserPassword)
    )
    $previousPgPassword = $env:PGPASSWORD
    try {
        $env:PGPASSWORD = $plainSuperuserPassword
        $sql | & $PsqlPath -U postgres -h $PgHost -p $Port -v ON_ERROR_STOP=1 --no-psqlrc
        if ($LASTEXITCODE -ne 0) {
            throw "psql retornou codigo $LASTEXITCODE ao criar role/banco -- confira a senha de superusuario do Postgres."
        }
    } finally {
        $plainSuperuserPassword = $null
        if ($null -eq $previousPgPassword) {
            Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
        } else {
            $env:PGPASSWORD = $previousPgPassword
        }
    }
}

function New-DatabaseConnectionString {
    param(
        [Parameter(Mandatory)][string]$RoleName,
        [Parameter(Mandatory)][string]$RolePassword,
        [Parameter(Mandatory)][string]$DatabaseName,
        [string]$PgHost = "localhost",
        [int]$Port = 5432
    )
    $encodedPassword = [Uri]::EscapeDataString($RolePassword)
    return "postgresql://${RoleName}:${encodedPassword}@${PgHost}:${Port}/${DatabaseName}"
}

function Get-DbPasswordFromConnectionString {
    <#
        Extrai de volta a senha de uma DATABASE_URL ja montada (usado quando
        uma tentativa anterior ja configurou a variavel de Maquina e so
        falta aplicar as migrations -- nao ha razao pra pedir a senha de
        novo, ja esta ali, so codificada pra URL).
    #>
    param([Parameter(Mandatory)][string]$ConnectionString)
    $uri = [Uri]$ConnectionString
    $userInfo = $uri.UserInfo -split ":", 2
    return [Uri]::UnescapeDataString($userInfo[1])
}

function Invoke-AppMigrations {
    <#
        Reimplementa em psql o que scripts/migrate.mjs faz em Node (mesma
        convencao de scripts/migration-plan.mjs: nome de arquivo como chave
        em _migrations, ordem alfabetica, so ".sql" direto em MigrationsDir,
        nunca descendo em subpastas como migrations/auth/).

        Precisa existir porque nem "npm run build" (roda na maquina do
        Victor, sem DATABASE_URL -- sempre imprime "skipping") nem o app em
        producao (so se automigra sozinho no caminho PGLite) aplicam isso
        contra o Postgres real do cliente. Sem este passo o banco fica vazio
        e o primeiro cadastro falha com "relacao 'user' nao existe".
    #>
    param(
        [Parameter(Mandatory)][string]$PsqlPath,
        [Parameter(Mandatory)][string]$RoleName,
        [Parameter(Mandatory)][string]$RolePassword,
        [Parameter(Mandatory)][string]$DatabaseName,
        [Parameter(Mandatory)][string]$MigrationsDir,
        [string]$PgHost = "localhost",
        [int]$Port = 5432
    )
    if (-not (Test-Path $MigrationsDir)) {
        Write-Host "Pasta de migrations nao encontrada em $MigrationsDir -- pulando." -ForegroundColor Yellow
        return
    }
    $arquivos = @(Get-ChildItem -Path $MigrationsDir -Filter "*.sql" -File | Sort-Object Name)
    if ($arquivos.Count -eq 0) { return }

    $env:PGPASSWORD = $RolePassword
    try {
        & $PsqlPath -U $RoleName -h $PgHost -p $Port -d $DatabaseName -v ON_ERROR_STOP=1 --no-psqlrc -c `
            "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
        if ($LASTEXITCODE -ne 0) { throw "Falha ao preparar a tabela _migrations (codigo $LASTEXITCODE)." }

        $aplicadasRaw = & $PsqlPath -U $RoleName -h $PgHost -p $Port -d $DatabaseName -v ON_ERROR_STOP=1 --no-psqlrc -t -A -c "SELECT name FROM _migrations"
        $aplicadas = @($aplicadasRaw | Where-Object { $_ })

        $pendentes = @($arquivos | Where-Object { $aplicadas -notcontains $_.Name })
        if ($pendentes.Count -eq 0) {
            Write-Host "  Banco ja estava com o schema em dia."
            return
        }

        foreach ($arquivo in $pendentes) {
            $nomeEscapado = $arquivo.Name -replace "'", "''"
            $caminhoPsql = $arquivo.FullName -replace '\\', '/'
            $script = @"
BEGIN;
\i '$caminhoPsql'
INSERT INTO _migrations (name) VALUES ('$nomeEscapado');
COMMIT;
"@
            $script | & $PsqlPath -U $RoleName -h $PgHost -p $Port -d $DatabaseName -v ON_ERROR_STOP=1 --no-psqlrc
            if ($LASTEXITCODE -ne 0) {
                throw "Migration $($arquivo.Name) falhou (codigo $LASTEXITCODE) -- confira o SQL desse arquivo."
            }
            Write-Host "  Aplicado $($arquivo.Name)"
        }
    } finally {
        Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
    }
}
