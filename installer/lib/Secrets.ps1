<#
    Geracao de segredos e variaveis de ambiente de Maquina.

    Nada aqui deve escrever um segredo em log, console ou arquivo de texto
    puro -- cada valor gerado vai direto para uma variavel de ambiente de
    Maquina ou para o stdin do psql, nunca para uma linha de comando (que
    apareceria na lista de processos) nem para um arquivo em disco.
#>

function New-RandomHexSecret {
    <#
        Segredo de app (ex.: BETTER_AUTH_SECRET) -- hex aleatorio, sem
        restricao de alfabeto porque nunca e digitado por um humano nem
        passado por um parser que trate certos caracteres como especiais.
    #>
    param(
        [int]$ByteLength = 32
    )
    $bytes = [byte[]]::new($ByteLength)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return -join ($bytes | ForEach-Object { $_.ToString("x2") })
}

function New-DbPassword {
    <#
        Senha do papel do Postgres -- so alfanumerico, de proposito: o valor
        atravessa uma connection-string estilo URL E um literal SQL entre
        aspas simples (New-AppDatabaseRole em Database.ps1); qualquer simbolo
        (@, :, /, ', %) exigiria escaping em um dos dois lugares e e um risco
        desnecessario para uma senha que nenhum humano precisa digitar.
    #>
    param(
        [int]$Length = 24
    )
    $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    $bytes = [byte[]]::new($Length)
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    } finally {
        $rng.Dispose()
    }
    return -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

function Set-MachineEnvVar {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][AllowEmptyString()][string]$Value
    )
    [Environment]::SetEnvironmentVariable($Name, $Value, "Machine")
}

function Get-MachineEnvVar {
    param([Parameter(Mandatory)][string]$Name)
    return [Environment]::GetEnvironmentVariable($Name, "Machine")
}

function Add-MachineEnvHost {
    <#
        Acrescenta um host a lista comma-separated de uma variavel de
        Maquina (usado por EXTRA_AUTH_HOSTS) sem duplicar nem apagar o que
        ja estava la -- Finish-TailscaleSetup.ps1 usa isso para nao perder o
        IP da LAN ja configurado no install inicial.
    #>
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$HostToAdd
    )
    $current = Get-MachineEnvVar -Name $Name
    $hosts = @()
    if ($current) {
        # O @(...) forca contexto de array mesmo quando o pipeline resulta em
        # um unico item -- sem isso, $hosts vira uma STRING escalar e "+="
        # abaixo faz concatenacao de texto (sem separador) em vez de anexar
        # ao array, corrompendo a lista silenciosamente.
        $hosts = @($current -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    if ($hosts -notcontains $HostToAdd) {
        $hosts += $HostToAdd
    }
    Set-MachineEnvVar -Name $Name -Value ($hosts -join ",")
}
