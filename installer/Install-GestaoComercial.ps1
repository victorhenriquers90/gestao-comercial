<#
.SYNOPSIS
    Instala ou atualiza o Gestao Comercial num PC de loja.

.DESCRIPTION
    Primeira instalacao: prove Node.js/PostgreSQL se faltarem, cria a role e o
    banco dedicados deste app, gera os segredos, configura variaveis de
    ambiente de Maquina, copia o app ja buildado, restringe o firewall,
    registra o servico do Windows e sobe o app.

    Atualizacao (quando ja existe C:\ProgramData\GestaoComercial\install-state.json):
    so troca os arquivos do app e reinicia o servico -- nunca regenera
    segredos nem mexe em firewall/rede/Tailscale de novo.

    PRECISA rodar num PowerShell como Administrador. Se a instancia do
    Postgres ja existir (por exemplo, servindo outro sistema do cliente), o
    script pede a senha de superusuario interativamente -- ele nunca a
    recebe como parametro de linha de comando nem a grava em lugar nenhum.

.PARAMETER AppSourceDir
    Pasta contendo o ".output" ja buildado (gerado com "npm run build" na
    maquina do Victor, empacotado junto do instalador -- este script NAO
    builda o app no PC do cliente).

.PARAMETER InstallDir
    Onde o app fica instalado no PC do cliente.

.PARAMETER Port
    Porta TCP do app (tambem usada nas regras de firewall).

.PARAMETER NodeMsiPath
    Instalador MSI do Node.js, usado somente se o Node nao estiver presente
    ou for de uma major abaixo do minimo suportado.

.PARAMETER PostgresInstallerPath
    Instalador do PostgreSQL (EDB), usado somente se nenhuma instancia for
    encontrada na maquina.

.PARAMETER TailscaleMsiPath
    Instalador do cliente Tailscale (opcional -- se omitido, o passo de
    Tailscale e so exibido como instrucao manual).

.PARAMETER NonInteractive
    Para quando este script e lancado por um processo pai sem console (a GUI
    do instalador) em vez de um terminal de verdade -- Read-Host (e
    especialmente -AsSecureString) depende de um host de console interativo
    e nao funciona direito com stdin/stdout redirecionados.

    Com este switch, antes de cada pergunta que normalmente usaria Read-Host,
    o script escreve uma linha-sentinela fixa no stdout (__NEED_PG_PASSWORD__
    ou __NEED_NETWORK_CONFIRM__) e SO ENTAO le a resposta via
    [Console]::In.ReadLine() -- a GUI observa o stdout dessas sentinelas e
    escreve a resposta no stdin do processo. Isso funciona mesmo se uma
    checagem previa da GUI tiver "adivinhado errado" se a pergunta seria
    necessaria: o script sempre avisa via sentinela antes de bloquear
    esperando entrada, entao a GUI nunca fica sem saber que precisa
    responder (evita o processo travar em silencio esperando uma resposta
    que nunca chegaria).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AppSourceDir,
    [string]$InstallDir = "C:\Apps\GestaoComercial",
    [int]$Port = 8080,
    [string]$NodeMsiPath,
    [string]$PostgresInstallerPath,
    [string]$TailscaleMsiPath,
    [int]$MinNodeMajorVersion = 20,
    [switch]$NonInteractive
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$libDir = Join-Path $PSScriptRoot "lib"
. (Join-Path $libDir "Secrets.ps1")
. (Join-Path $libDir "Database.ps1")
. (Join-Path $libDir "Network.ps1")
. (Join-Path $libDir "WindowsService.ps1")
. (Join-Path $libDir "Prerequisites.ps1")

$StateDir = "C:\ProgramData\GestaoComercial"
$StateFile = Join-Path $StateDir "install-state.json"
$DbRoleName = "gestao_app"
$DbName = "gestao_comercial"
# nssm.exe precisa sobreviver ao instalador/staging (que pode ser apagado
# depois) para que Finish-TailscaleSetup.ps1 e atualizacoes futuras ainda
# consigam gerenciar o servico -- por isso copiado para $StateDir, nao
# referenciado direto de $PSScriptRoot.
$NssmSourcePath = Join-Path $PSScriptRoot "vendor\nssm.exe"
$NssmPath = Join-Path $StateDir "nssm.exe"
# Garantido aqui, incondicional -- $StateDir so era criado incidentalmente
# por ramos especificos (postgres recem-instalado, ou so no fim via
# Save-InstallState), entao um caminho que pula esses ramos (ex.: retomando
# uma instalacao que ja tinha banco/segredos configurados) chegava no passo
# do NSSM sem essa pasta existir -- foi o erro real visto no primeiro teste
# da GUI ("Copy-Item: nao foi possivel localizar uma parte do caminho").
New-Item -ItemType Directory -Path $StateDir -Force | Out-Null

function Read-SecureAnswer {
    param(
        [Parameter(Mandatory)][string]$Sentinel,
        [Parameter(Mandatory)][string]$InteractivePrompt
    )
    if ($NonInteractive) {
        Write-Host $Sentinel
        $line = [Console]::In.ReadLine()
        $secure = ConvertTo-SecureString $line -AsPlainText -Force
        $line = $null
        return $secure
    }
    return Read-Host -AsSecureString -Prompt $InteractivePrompt
}

function Read-PlainAnswer {
    param(
        [Parameter(Mandatory)][string]$Sentinel,
        [Parameter(Mandatory)][string]$InteractivePrompt
    )
    if ($NonInteractive) {
        Write-Host $Sentinel
        return [Console]::In.ReadLine()
    }
    return Read-Host -Prompt $InteractivePrompt
}

function Assert-RunningAsAdministrator {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw "Este script precisa rodar num PowerShell como Administrador."
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-CurrentAppMigrations {
    <#
        Fininho em volta de Invoke-AppMigrations (lib/Database.ps1) so pra nao
        repetir Get-PostgresInstallDir/psqlPath/MigrationsDir nos 3 lugares
        que precisam disto (atualizacao, instalacao "ja configurada" e
        instalacao nova do zero) -- foi exatamente esquecer um desses 3
        lugares que deixou o banco sem schema numa versao anterior deste
        script.
    #>
    param([Parameter(Mandatory)][string]$RolePassword)
    $psqlPath = Join-Path (Get-PostgresInstallDir) "bin\psql.exe"
    Invoke-AppMigrations -PsqlPath $psqlPath -RoleName $DbRoleName -RolePassword $RolePassword `
        -DatabaseName $DbName -MigrationsDir (Join-Path $AppSourceDir "migrations")
}

function Get-BrowserAppModeExe {
    <#
        Chrome/Edge, nessa ordem de preferencia -- os dois suportam
        "--app=<url>", que abre so o conteudo da pagina, sem barra de
        endereco nem abas, como se fosse um programa nativo em vez de uma
        aba de navegador comum.
    #>
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

function Add-AppShortcut {
    <#
        Atalho na area de trabalho de TODOS os usuarios (CommonDesktopDirectory,
        nao a de um usuario especifico) -- essa maquina e um PC compartilhado de
        loja, nao faz sentido o atalho existir so pra quem instalou.
        Idempotente: sobrescreve se ja existir, seguro de rodar de novo numa
        atualizacao.
    #>
    param(
        [Parameter(Mandatory)][string]$BrowserExePath,
        [Parameter(Mandatory)][int]$Port
    )
    $shortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) "Gestao Comercial.lnk"
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $BrowserExePath
    # --kiosk (nao --app): tela cheia de verdade, sem nenhuma barra de titulo --
    # --app ainda deixa uma faixa minima com os botoes de minimizar/fechar.
    # Alt+F4 fecha a janela normalmente.
    #
    # --user-data-dir com perfil proprio: se o Chrome do usuario ja estiver
    # aberto por qualquer outro motivo (nota fiscal, e-mail), o Chrome
    # repassa o lancamento pra instancia existente e IGNORA --kiosk -- visto
    # ao vivo na maquina piloto (abriu como app instalado normal, com barra
    # de titulo). Um perfil separado forca sempre um processo novo e
    # independente, garantindo o kiosk mesmo com outro Chrome ja rodando.
    # --no-first-run/--no-default-browser-check: um perfil novo em folha
    # (--user-data-dir acima) faz o Chrome mostrar a tela de boas-vindas/
    # login na primeira vez -- essa tela e uma janela normal, com barra de
    # titulo, que trava o kiosk ate alguem clicar nela manualmente (visto ao
    # vivo na maquina piloto). Essas duas flags pulam essa tela direto.
    $kioskProfileDir = Join-Path $StateDir "chrome-kiosk-profile"
    $shortcut.Arguments = "--kiosk --no-first-run --no-default-browser-check --user-data-dir=`"$kioskProfileDir`" http://localhost:$Port"
    $shortcut.IconLocation = $BrowserExePath
    $shortcut.Description = "Gestao Comercial"
    $shortcut.Save()
}

function Write-ProtectedSecretFile {
    <#
        Guarda um segredo de recuperacao (a senha de superusuario do Postgres,
        quando GERADA por este script numa instalacao nova do zero) num
        arquivo local restrito so a Administradores -- nunca exibido no
        console, nunca enviado a lugar nenhum. Existe pra nao perder o acesso
        de superusuario pra sempre caso alguem precise dele depois.
    #>
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$Content
    )
    Set-Content -Path $Path -Value $Content -NoNewline
    icacls $Path /inheritance:r | Out-Null
    icacls $Path /grant:r "*S-1-5-32-544:F" | Out-Null # Administradores locais, somente.
    icacls $Path /grant:r "*S-1-5-18:F" | Out-Null      # SYSTEM.
}

function Get-InstallState {
    if (Test-Path $StateFile) {
        return Get-Content $StateFile -Raw | ConvertFrom-Json
    }
    return $null
}

function Save-InstallState {
    param([hashtable]$State)
    New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
    $State | ConvertTo-Json | Set-Content -Path $StateFile
}

function Test-AppHealthy {
    <#
        90s, nao 30s: visto ao vivo na maquina piloto um caso em que o app
        subiu e ficou saudavel poucos segundos depois do timeout antigo
        estourar (provavelmente antivirus escaneando os arquivos recem-
        copiados, ou a primeira conexao com o Postgres) -- o script relatava
        "falhou" mesmo com o servico no ar e funcionando normalmente.
    #>
    param([int]$TimeoutSeconds = 90)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -Uri "http://localhost:$Port" -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {
            Start-Sleep -Seconds 1
        }
    }
    return $false
}

function Copy-AppFiles {
    param([switch]$IsUpdate)
    if ($IsUpdate -and (Test-Path $InstallDir)) {
        # Preserva node_modules se algum dia existir fora do .output
        # autocontido, mas o .output do preset node-server e projetado pra
        # ser substituido inteiro sem estado externo.
        Remove-Item (Join-Path $InstallDir ".output") -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    Copy-Item -Path (Join-Path $AppSourceDir ".output") -Destination $InstallDir -Recurse -Force
}

# ---------------------------------------------------------------------------

Assert-RunningAsAdministrator

$existingState = Get-InstallState
$isUpdate = [bool]$existingState -and (Test-AppServiceExists)

if ($isUpdate) {
    Write-Step "Instalacao existente detectada -- modo atualizacao (arquivos + reinicio do servico apenas)."

    Stop-AppService
    Copy-AppFiles -IsUpdate
    $nodeExe = Get-NodeExePath
    $entryScript = Join-Path $InstallDir ".output\server\index.mjs"
    if (-not (Test-Path $NssmPath)) {
        Copy-Item -Path $NssmSourcePath -Destination $NssmPath -Force
    }

    Write-Step "Conferindo schema do banco de dados."
    $dbPasswordExistente = Get-DbPasswordFromConnectionString -ConnectionString (Get-MachineEnvVar -Name "DATABASE_URL")
    Invoke-CurrentAppMigrations -RolePassword $dbPasswordExistente
    $dbPasswordExistente = $null

    Update-AppServiceBinary -NssmPath $NssmPath -NodeExePath $nodeExe -EntryScriptPath $entryScript
    Start-AppService

    if (-not (Test-AppHealthy)) {
        throw "O app nao respondeu em http://localhost:$Port apos a atualizacao -- confira os logs em $(Join-Path $StateDir 'logs') (stdout.log / stderr.log)."
    }

    $browserExe = Get-BrowserAppModeExe
    if ($browserExe) {
        Add-AppShortcut -BrowserExePath $browserExe -Port $Port
    }

    Save-InstallState -State @{
        version     = (Get-Date -Format "yyyyMMddHHmmss")
        lastUpdated = (Get-Date -Format "o")
        installDir  = $InstallDir
        port        = $Port
    }
    Write-Host ""
    Write-Host "Atualizacao concluida. http://localhost:$Port respondendo." -ForegroundColor Green
    return
}

Write-Step "Instalacao nova."

Write-Step "Verificando Node.js (minimo v$MinNodeMajorVersion)."
if (-not (Test-NodeInstalled -MinMajorVersion $MinNodeMajorVersion)) {
    if (-not $NodeMsiPath) {
        throw "Node.js nao encontrado e -NodeMsiPath nao foi informado."
    }
    Write-Host "Instalando Node.js..."
    Install-NodeSilently -MsiPath $NodeMsiPath
}
$nodeExe = Get-NodeExePath
if (-not $nodeExe) { throw "Node.js foi instalado mas o executavel nao foi encontrado." }

if (Get-MachineEnvVar -Name "DATABASE_URL") {
    # Uma tentativa anterior ja chegou ate aqui e configurou banco/segredos
    # com sucesso (esta variavel so e escrita depois que tudo antes dela deu
    # certo) -- so faltou concluir os passos seguintes (provavelmente essa
    # mesma execucao falhou mais na frente, ex.: registro do servico). NAO
    # regenerar a senha do banco aqui: geraria uma nova string sem atualizar
    # a senha de verdade da role no Postgres, deixando DATABASE_URL
    # incompativel com o banco real.
    Write-Step "Banco e segredos ja configurados por uma tentativa anterior -- pulando para o restante da instalacao."
    $lanIp = Get-MachineEnvVar -Name "EXTRA_AUTH_HOSTS"

    Write-Step "Conferindo schema do banco de dados."
    $dbPasswordExistente = Get-DbPasswordFromConnectionString -ConnectionString (Get-MachineEnvVar -Name "DATABASE_URL")
    Invoke-CurrentAppMigrations -RolePassword $dbPasswordExistente
    $dbPasswordExistente = $null
} else {
    Write-Step "Verificando PostgreSQL."
    $postgresJustInstalled = $false
    if (-not (Test-PostgresInstalled)) {
        if (-not $PostgresInstallerPath) {
            throw "PostgreSQL nao encontrado e -PostgresInstallerPath nao foi informado."
        }
        Write-Host "Instalando PostgreSQL (isso gera uma senha de superusuario local -- ver aviso no final)..."
        $superuserPassword = ConvertTo-SecureString (New-DbPassword -Length 32) -AsPlainText -Force
        Install-PostgresSilently -InstallerExePath $PostgresInstallerPath -SuperuserPassword $superuserPassword
        $postgresJustInstalled = $true
    } else {
        Write-Host "PostgreSQL ja instalado nesta maquina -- sera usada a instancia existente, sem alterar outros bancos/roles dela."
        $superuserPassword = Read-SecureAnswer -Sentinel "__NEED_PG_PASSWORD__" `
            -InteractivePrompt "Senha de superusuario 'postgres' desta instancia"
    }

    Write-Step "Criando role e banco dedicados ($DbRoleName / $DbName)."
    $psqlPath = Join-Path (Get-PostgresInstallDir) "bin\psql.exe"
    $dbPassword = New-DbPassword
    New-AppDatabaseRole -PsqlPath $psqlPath -RoleName $DbRoleName -RolePassword $dbPassword `
        -DatabaseName $DbName -SuperuserPassword $superuserPassword -Port 5432

    Write-Step "Aplicando schema do banco de dados."
    Invoke-CurrentAppMigrations -RolePassword $dbPassword

    if ($postgresJustInstalled) {
        New-Item -ItemType Directory -Path $StateDir -Force | Out-Null
        $recoveryFile = Join-Path $StateDir "postgres-superuser.txt"
        $plainSuperuser = [System.Runtime.InteropServices.Marshal]::PtrToStringUni(
            [System.Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($superuserPassword)
        )
        Write-ProtectedSecretFile -Path $recoveryFile -Content $plainSuperuser
        $plainSuperuser = $null
        Write-Host "Senha de superusuario do Postgres salva (acesso restrito a administradores) em: $recoveryFile" -ForegroundColor Yellow
        Write-Host "Guarde-a num cofre de senhas e apague o arquivo, se preferir." -ForegroundColor Yellow
    }
    $superuserPassword = $null

    Write-Step "Gerando segredos do app."
    $betterAuthSecret = New-RandomHexSecret
    $databaseUrl = New-DatabaseConnectionString -RoleName $DbRoleName -RolePassword $dbPassword -DatabaseName $DbName
    $dbPassword = $null

    Write-Step "Detectando IP local da loja."
    $lanIp = Get-LanIPv4Address
    Write-Host "IP local detectado: $lanIp"

    Write-Step "Configurando variaveis de ambiente de Maquina."
    Set-MachineEnvVar -Name "DATABASE_URL" -Value $databaseUrl
    Set-MachineEnvVar -Name "VITE_AUTH_ENABLED" -Value "true"
    Set-MachineEnvVar -Name "BETTER_AUTH_SECRET" -Value $betterAuthSecret
    Set-MachineEnvVar -Name "EXTRA_AUTH_HOSTS" -Value $lanIp
    Set-MachineEnvVar -Name "HOST" -Value "0.0.0.0"
    Set-MachineEnvVar -Name "PORT" -Value "$Port"
}
$databaseUrl = $null
$betterAuthSecret = $null

Write-Step "Copiando arquivos do app para $InstallDir."
Copy-AppFiles

Write-Step "Configurando firewall (porta $Port, so rede privada)."
Remove-BroadNodeFirewallRules -NodeExePath $nodeExe
Set-ScopedFirewallRule -DisplayName "Gestao Comercial - PDV (LAN)" -Port $Port -ProgramPath $nodeExe -Profile "Private"

Write-Step "Verificando categoria da rede."
if (-not (Test-NetworkCategoryIsPrivate)) {
    Write-Host ""
    Write-Host "AVISO: uma das redes ativas desta maquina esta marcada como 'Publica' no Windows." -ForegroundColor Yellow
    Write-Host "Isso normalmente esta errado pra rede interna de uma loja. Confira com:" -ForegroundColor Yellow
    Write-Host "  Get-NetConnectionProfile" -ForegroundColor Yellow
    Write-Host "E, se for mesmo a rede confiavel da loja, marque como Privada:" -ForegroundColor Yellow
    Write-Host "  Set-NetConnectionProfile -InterfaceAlias '<nome>' -NetworkCategory Private" -ForegroundColor Yellow
    $confirmation = Read-PlainAnswer -Sentinel "__NEED_NETWORK_CONFIRM__" -InteractivePrompt "Continuar mesmo assim? (s/N)"
    if ($confirmation -notmatch "^[sS]") {
        throw "Instalacao interrompida pelo operador (rede marcada como Publica)."
    }
}

if ($TailscaleMsiPath -and (Test-Path $TailscaleMsiPath)) {
    Write-Step "Instalando cliente Tailscale (login continua manual)."
    Start-Process msiexec.exe -ArgumentList "/i", "`"$TailscaleMsiPath`"", "/quiet", "/norestart" -Wait
} else {
    Write-Step "Tailscale nao incluido neste pacote -- instale manualmente se o responsavel precisar de acesso remoto."
}
Write-Host ""
Write-Host "Para liberar acesso remoto do responsavel da loja, rode 'tailscale login' e depois:" -ForegroundColor Cyan
Write-Host "  installer\Finish-TailscaleSetup.ps1" -ForegroundColor Cyan

Write-Step "Registrando servico do Windows (via NSSM)."
if (-not (Test-Path $NssmPath)) {
    Copy-Item -Path $NssmSourcePath -Destination $NssmPath -Force
}
$entryScript = Join-Path $InstallDir ".output\server\index.mjs"
$logDir = Join-Path $StateDir "logs"
New-AppService -NssmPath $NssmPath -NodeExePath $nodeExe -EntryScriptPath $entryScript -LogDir $logDir
Start-AppService

Write-Step "Checando saude do app."
if (-not (Test-AppHealthy)) {
    throw "O app nao respondeu em http://localhost:$Port -- confira os logs em $logDir (stdout.log / stderr.log) antes de liberar a loja."
}

Write-Step "Criando atalho na area de trabalho."
$browserExe = Get-BrowserAppModeExe
if ($browserExe) {
    Add-AppShortcut -BrowserExePath $browserExe -Port $Port
    Write-Host "Atalho 'Gestao Comercial' criado -- abre o sistema em janela propria, sem barra de endereco nem abas."
} else {
    Write-Host "Nenhum Chrome/Edge encontrado -- atalho nao criado. Acesse http://localhost:$Port manualmente." -ForegroundColor Yellow
}

Save-InstallState -State @{
    version     = (Get-Date -Format "yyyyMMddHHmmss")
    installedAt = (Get-Date -Format "o")
    installDir  = $InstallDir
    port        = $Port
    lanIp       = $lanIp
}

Write-Host ""
Write-Host "Instalacao concluida." -ForegroundColor Green
Write-Host "PDV local: http://localhost:$Port ou http://${lanIp}:$Port" -ForegroundColor Green
Write-Host "O primeiro cadastro feito no sistema vira administrador automaticamente." -ForegroundColor Green
