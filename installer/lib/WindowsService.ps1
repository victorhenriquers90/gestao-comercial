<#
    Registra o servidor Node como servico do Windows via NSSM
    (installer\vendor\nssm.exe -- non-sucking service manager, open source,
    amplamente usado ha mais de uma decada).

    Por que NSSM e nao sc.exe/New-Service direto: um executavel comum como
    node.exe nao fala o protocolo de Service Control Manager que o Windows
    exige de um servico de verdade (StartServiceCtrlDispatcher etc.) --
    confirmado na pratica na loja piloto: o servico criado com New-Service
    ficava "Parado" pro Windows enquanto o processo node.exe rodava orfao por
    baixo, sem ninguem gerenciando reinicio/logs, e sem nada escutando na
    porta esperada. NSSM E o servico de verdade (satisfaz o protocolo do
    SCM) e gerencia o node.exe como processo filho -- reinicia sozinho se
    cair, e redireciona stdout/stderr pra arquivo (sem isso nao ha como
    diagnosticar uma falha de boot do app depois de instalado).

    Uma vez instalado via NSSM, o servico responde normalmente a
    Start-Service/Stop-Service/Get-Service -- so a configuracao inicial
    passa pelo nssm.exe.
#>

$script:AppServiceName = "GestaoComercial"

function Test-AppServiceExists {
    return [bool](Get-Service -Name $script:AppServiceName -ErrorAction SilentlyContinue)
}

function Test-AppServiceIsNssmManaged {
    <#
        Confere o ImagePath gravado no registro do servico -- um registrado
        via NSSM aponta pro proprio nssm.exe (que so entao lanca o node.exe
        como filho); um registrado pelo sc.exe/New-Service antigo (antes da
        migracao pra NSSM, ver comentario no topo do arquivo) aponta direto
        pro node.exe.
    #>
    $imagePath = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Services\$script:AppServiceName" `
        -Name "ImagePath" -ErrorAction SilentlyContinue).ImagePath
    return $imagePath -and $imagePath -like "*nssm.exe*"
}

function New-AppService {
    param(
        [Parameter(Mandatory)][string]$NssmPath,
        [Parameter(Mandatory)][string]$NodeExePath,
        [Parameter(Mandatory)][string]$EntryScriptPath,
        [Parameter(Mandatory)][string]$LogDir
    )
    if (Test-AppServiceExists) {
        if (Test-AppServiceIsNssmManaged) {
            throw "Servico $script:AppServiceName ja existe -- use Update-AppServiceBinary para atualizar, nao New-AppService."
        }
        # Sobra de uma versao anterior deste instalador (sc.exe create/
        # New-Service direto, sem NSSM) -- ficava "Parado" com um node.exe
        # orfao por baixo (o motivo de termos migrado pra NSSM). Remove
        # sozinho em vez de exigir um "sc.exe delete" manual do operador.
        Stop-Service -Name $script:AppServiceName -Force -ErrorAction SilentlyContinue
        & sc.exe delete $script:AppServiceName | Out-Null
        # So mata o node.exe que sobrou orfao do servico quebrado -- filtra
        # pelo script que ele esta rodando, nunca mata node.exe de outra
        # coisa que por acaso esteja rodando na mesma maquina.
        Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
            Where-Object { $_.CommandLine -match [regex]::Escape($EntryScriptPath) } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    }
    if (-not (Test-Path $NssmPath)) {
        throw "nssm.exe nao encontrado em $NssmPath."
    }
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

    & $NssmPath install $script:AppServiceName $NodeExePath
    if ($LASTEXITCODE -ne 0) { throw "nssm install falhou (codigo $LASTEXITCODE)." }

    & $NssmPath set $script:AppServiceName AppParameters $EntryScriptPath | Out-Null
    & $NssmPath set $script:AppServiceName AppDirectory (Split-Path $EntryScriptPath -Parent) | Out-Null
    & $NssmPath set $script:AppServiceName DisplayName "Gestao Comercial (PDV/ERP)" | Out-Null
    & $NssmPath set $script:AppServiceName Description "Servidor local do sistema Gestao Comercial. Nao encerrar manualmente." | Out-Null
    & $NssmPath set $script:AppServiceName Start SERVICE_AUTO_START | Out-Null
    & $NssmPath set $script:AppServiceName AppStdout (Join-Path $LogDir "stdout.log") | Out-Null
    & $NssmPath set $script:AppServiceName AppStderr (Join-Path $LogDir "stderr.log") | Out-Null
    & $NssmPath set $script:AppServiceName AppRotateFiles 1 | Out-Null
    & $NssmPath set $script:AppServiceName AppRotateBytes 5242880 | Out-Null
    # NSSM ja reinicia o processo filho sozinho por padrao em caso de queda
    # (throttle default e razoavel) -- nao precisa de configuracao extra
    # equivalente ao antigo "sc.exe failure".
}

function Update-AppServiceBinary {
    <#
        Usado no modo atualizacao: o servico ja existe, so o caminho do
        entrypoint pode ter mudado (ex.: reinstalacao em outra pasta).
    #>
    param(
        [Parameter(Mandatory)][string]$NssmPath,
        [Parameter(Mandatory)][string]$NodeExePath,
        [Parameter(Mandatory)][string]$EntryScriptPath
    )
    if (-not (Test-AppServiceExists)) {
        throw "Servico $script:AppServiceName nao existe -- use New-AppService para criar."
    }
    & $NssmPath set $script:AppServiceName Application $NodeExePath | Out-Null
    & $NssmPath set $script:AppServiceName AppParameters $EntryScriptPath | Out-Null
    & $NssmPath set $script:AppServiceName AppDirectory (Split-Path $EntryScriptPath -Parent) | Out-Null
}

function Start-AppService {
    Start-Service -Name $script:AppServiceName
}

function Stop-AppService {
    param(
        [int]$TimeoutSeconds = 30
    )
    if (-not (Test-AppServiceExists)) { return }
    $svc = Get-Service -Name $script:AppServiceName
    if ($svc.Status -eq "Stopped") { return }
    Stop-Service -Name $script:AppServiceName -Force
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Service -Name $script:AppServiceName).Status -ne "Stopped" -and (Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
    }
}

function Restart-AppService {
    Stop-AppService
    Start-AppService
}

function Remove-AppService {
    param(
        [string]$NssmPath
    )
    if (-not (Test-AppServiceExists)) { return }
    Stop-AppService
    if ($NssmPath -and (Test-Path $NssmPath)) {
        & $NssmPath remove $script:AppServiceName confirm | Out-Null
    } else {
        & sc.exe delete $script:AppServiceName | Out-Null
    }
}
