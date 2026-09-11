<#
    Deteccao de IP local, regras de firewall e checagem de categoria de rede.
#>

function Get-LanIPv4Address {
    <#
        Usa a interface da rota padrao (0.0.0.0/0) em vez de fixar num nome
        de adaptador ("Wi-Fi"/"Ethernet") -- isso varia de PC pra PC entre
        clientes, a rota padrao nao.
    #>
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object -Property RouteMetric |
        Select-Object -First 1
    if (-not $route) {
        throw "Nao foi possivel detectar a interface de rede padrao desta loja."
    }
    $ip = Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1
    if (-not $ip) {
        throw "Nao foi possivel detectar o IP local desta loja."
    }
    return $ip.IPAddress
}

function Test-NetworkCategoryIsPrivate {
    <#
        Confere so a categoria da interface da ROTA PADRAO (a mesma que
        Get-LanIPv4Address usa) -- nao de todas as interfaces indiscriminadamente.
        Um PC pode ter adaptadores virtuais/loopback (VPN, Hyper-V, sensores)
        marcados como "Publico" pelo Windows sem que isso tenha nada a ver com
        a rede real da loja; varrer todo Get-NetConnectionProfile geraria um
        aviso falso-positivo em toda instalacao (confirmado rodando na maquina
        piloto: o adaptador real da loja estava Privado, mas um loopback
        interno estava Publico, e a versao antiga desta funcao acusava a rede
        toda como publica por causa dele).
    #>
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue |
        Sort-Object -Property RouteMetric |
        Select-Object -First 1
    if (-not $route) { return $true }
    $profile = Get-NetConnectionProfile -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
    if (-not $profile) { return $true }
    return $profile.NetworkCategory -ne "Public"
}

function Remove-BroadNodeFirewallRules {
    <#
        O prompt padrao do Windows ("Permitir acesso") ao rodar node.exe pela
        primeira vez cria regras sem escopo de porta (qualquer porta,
        TCP+UDP) -- essas precisam sumir antes de uma regra restrita fazer
        sentido, senao as duas convivem e a ampla ainda libera tudo.
    #>
    param(
        [Parameter(Mandatory)][string]$NodeExePath
    )
    Get-NetFirewallRule -Direction Inbound -ErrorAction SilentlyContinue | ForEach-Object {
        $rule = $_
        $appFilter = $rule | Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue
        if (-not $appFilter -or $appFilter.Program -ne $NodeExePath) { return }
        $portFilter = $rule | Get-NetFirewallPortFilter -ErrorAction SilentlyContinue
        if ($portFilter -and $portFilter.LocalPort -eq "Any") {
            $rule | Remove-NetFirewallRule
        }
    }
}

function Set-ScopedFirewallRule {
    <#
        Cria (substituindo qualquer versao anterior com o mesmo nome) uma
        regra de entrada restrita a uma porta/perfil/origem especificos.
    #>
    param(
        [Parameter(Mandatory)][string]$DisplayName,
        [Parameter(Mandatory)][int]$Port,
        [Parameter(Mandatory)][string]$ProgramPath,
        [string]$Profile = "Private",
        [string]$RemoteAddress = "Any"
    )
    Get-NetFirewallRule -DisplayName $DisplayName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $DisplayName -Direction Inbound -Action Allow `
        -Protocol TCP -LocalPort $Port -Profile $Profile -Program $ProgramPath `
        -RemoteAddress $RemoteAddress | Out-Null
}
