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
