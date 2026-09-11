<#
    Deteccao e instalacao silenciosa de Node.js e PostgreSQL.

    O instalador do PostgreSQL (EDB) muda a sintaxe exata de flags entre
    versoes do instalador com mais frequencia que o do Node -- o
    Install-PostgresSilently abaixo segue a sintaxe unattended documentada
    pela EDB, mas PRECISA ser validado contra o instalador de verdade (baixado
    em installer/vendor/, ver README) antes de confiar nele numa loja real.
    Test-NodeInstalled/Test-PostgresInstalled (deteccao) nao tem essa
    fragilidade -- so leem o que ja esta instalado.
#>

function Test-NodeInstalled {
    param(
        [int]$MinMajorVersion = 20
    )
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { return $false }
    $verOutput = & node --version
    if ($verOutput -match "^v(\d+)\.") {
        return [int]$Matches[1] -ge $MinMajorVersion
    }
    return $false
}

function Get-NodeExePath {
    $node = Get-Command node -ErrorAction SilentlyContinue
    if ($node) { return $node.Source }
    $fallback = "C:\Program Files\nodejs\node.exe"
    if (Test-Path $fallback) { return $fallback }
    return $null
}

function Install-NodeSilently {
    param(
        [Parameter(Mandatory)][string]$MsiPath
    )
    if (-not (Test-Path $MsiPath)) {
        throw "Instalador do Node.js nao encontrado em $MsiPath."
    }
    $log = Join-Path $env:TEMP "gestao-comercial-node-install.log"
    $proc = Start-Process msiexec.exe -ArgumentList @(
        "/i", "`"$MsiPath`"", "/quiet", "/norestart", "/l*v", "`"$log`""
    ) -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "Instalacao do Node.js falhou (codigo $($proc.ExitCode)) -- log em $log."
    }
    # msiexec retorna antes do PATH da sessao atual ser atualizado; recarrega
    # a partir do registro pra Get-NodeExePath enxergar o node recem-instalado
    # sem precisar reabrir o processo do instalador.
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $env:Path = "$machinePath;$env:Path"
}

function Test-PostgresInstalled {
    return [bool](Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue)
}

function Get-PostgresInstallDir {
    <#
        Retorna a pasta de instalacao (ex.: "C:\Program Files\PostgreSQL\17")
        da versao mais recente encontrada, ou $null se nao houver nenhuma.
    #>
    $root = "C:\Program Files\PostgreSQL"
    if (-not (Test-Path $root)) { return $null }
    # @(...) forca contexto de array -- com uma unica versao do Postgres
    # instalada (o caso comum), o pipeline sem isso desempacota pro objeto
    # escalar, e ".Count" quebra sob Set-StrictMode (era o erro real visto
    # ao rodar isto pela primeira vez na maquina piloto: "a propriedade
    # 'Count' nao foi encontrada").
    $candidates = @(Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName "bin\psql.exe") } |
        Sort-Object Name -Descending)
    if ($candidates.Count -eq 0) { return $null }
    return $candidates[0].FullName
}

function Install-PostgresSilently {
    <#
        Instala o PostgreSQL sem instancia previa, ja restringindo
        listen_addresses a localhost desde o primeiro start (nao precisa
        corrigir depois, diferente do que fizemos manualmente na loja piloto).

        ATENCAO: valide os nomes de flag abaixo contra o instalador real
        antes de usar em producao -- a EDB muda essas flags entre releases
        do instalador (nao da versao do Postgres em si).
    #>
    param(
        [Parameter(Mandatory)][string]$InstallerExePath,
        [Parameter(Mandatory)][System.Security.SecureString]$SuperuserPassword,
        [int]$Port = 5432
    )
    if (-not (Test-Path $InstallerExePath)) {
        throw "Instalador do PostgreSQL nao encontrado em $InstallerExePath."
    }
    $plainPassword = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
        [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($SuperuserPassword)
    )
    $log = Join-Path $env:TEMP "gestao-comercial-postgres-install.log"
    try {
        $proc = Start-Process $InstallerExePath -ArgumentList @(
            "--unattendedmodeui", "none",
            "--mode", "unattended",
            "--superpassword", "`"$plainPassword`"",
            "--serverport", "$Port",
            "--enable_acledit", "0",
            "--install_runtimes", "0"
        ) -Wait -PassThru
        if ($proc.ExitCode -ne 0) {
            throw "Instalacao do PostgreSQL falhou (codigo $($proc.ExitCode)) -- log em $log."
        }
    } finally {
        $plainPassword = $null
    }

    $installDir = Get-PostgresInstallDir
    if (-not $installDir) {
        throw "PostgreSQL instalado mas a pasta de instalacao nao foi encontrada."
    }
    $confPath = Join-Path $installDir "data\postgresql.conf"
    (Get-Content $confPath) -replace "^\s*#?\s*listen_addresses\s*=.*", "listen_addresses = 'localhost'" |
        Set-Content $confPath

    $serviceName = (Get-Service -Name "postgresql*" | Select-Object -First 1).Name
    Restart-Service -Name $serviceName -Force
}
