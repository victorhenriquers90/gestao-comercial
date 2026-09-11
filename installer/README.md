# Instalador do Gestao Comercial

Automatiza o que fizemos manualmente na loja piloto: banco Postgres dedicado,
segredos, variaveis de ambiente, firewall, servico do Windows. Ver o plano da
sessao que originou isso (arquitetura completa e riscos em aberto) se precisar
do contexto de "por que" antes de mudar algo aqui.

## Estrutura

- `Install-GestaoComercial.ps1` -- motor principal. Primeira instalacao ou
  atualizacao, dependendo de achar ou nao `C:\ProgramData\GestaoComercial\install-state.json`.
- `lib\*.ps1` -- modulos usados pelo motor (segredos, banco, rede, servico,
  pre-requisitos). Dot-sourced automaticamente, nao precisam ser chamados
  direto.
- `Finish-TailscaleSetup.ps1` -- roda uma vez, DEPOIS que o responsavel da
  loja fizer `tailscale login` manualmente.
- `Uninstall-GestaoComercial.ps1` -- remove o servico/app. Por padrao NUNCA
  apaga o banco de dados nem os segredos (precisa de `-RemoveData` explicito).
- `vendor\` (voce cria, nao versionado) -- instaladores de terceiros
  opcionais, ver abaixo.

A casca grafica fica em `..\installer-gui\GestaoComercialSetup\` (app WPF em
.NET) -- é ela que o cliente final recebe e clica. Referencia os arquivos
deste `installer\` por caminho relativo (nunca copia), entao editar o
PowerShell aqui ja reflete no proximo `dotnet publish`.

## Gerando um release para um cliente novo

1. **Builda o app** (nesta pasta do Victor, nao no PC do cliente):
   ```
   cd C:\Users\victo\Documents\gestao-comercial
   npm run build
   ```
   Confere que `.output\server\index.mjs` existe depois disso.

2. **(Opcional) Baixe os instaladores de terceiros**, se o PC do cliente
   ainda nao tiver Node/PostgreSQL/Tailscale, e coloque em
   `installer\vendor\` com estes nomes exatos:
   - `node.msi` -- MSI oficial do Node.js LTS (nodejs.org). Fixe sempre a
     mesma versao entre releases para nao ter deriva entre clientes.
   - `postgres-installer.exe` -- instalador da EDB (postgresql.org/download/windows).
     **Antes de confiar nisso numa loja real**: os nomes de flag em
     `lib\Prerequisites.ps1::Install-PostgresSilently` foram escritos pela
     documentacao publica da EDB, nao testados contra o instalador de
     verdade ainda -- teste numa VM limpa primeiro.
   - `tailscale-setup.exe` -- instalador oficial do Tailscale (tailscale.com/download).

   Se o PC do cliente **ja tem** os tres (como na loja piloto), pule este
   passo -- o instalador detecta e usa o que ja existe, sem baixar nada.

3. **Compile o instalador** (produz um `.exe` unico, autocontido -- ninguem
   precisa instalar .NET na maquina do cliente):
   ```
   dotnet publish installer-gui\GestaoComercialSetup\GestaoComercialSetup.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeAllContentForSelfExtract=true -p:EnableCompressionInSingleFile=true -o installer-gui\publish
   ```
   Gera `installer-gui\publish\GestaoComercialSetup.exe` (~70-80MB, isso e
   esperado -- e um app WPF autocontido). Renomeie por release se quiser
   versionar no nome (ex.: `GestaoComercial-Setup-1.2.0.exe`).

4. **Mande esse `.exe` pro cliente.** So precisa dar duplo-clique -- o
   manifesto do app (`app.manifest`, `requireAdministrator`) ja pede a
   elevacao pelo UAC do Windows sozinho, sem precisar de instrucao de
   "clique com botao direito". O unico passo manual que sobra e o login no
   Tailscale (a GUI mostra a instrucao na tela quando chega nesse ponto).

## O que o instalador faz (resumo -- detalhe em `Install-GestaoComercial.ps1`)

1. Confere/instala Node.js e PostgreSQL se faltarem.
2. Cria uma role e um banco **dedicados** deste app dentro do Postgres
   (nunca toca em outros bancos que possam existir na mesma instancia).
3. Gera a senha do banco e o `BETTER_AUTH_SECRET` sozinho -- ninguem (nem
   voce, nem quem escreveu este instalador) ve ou digita esses valores.
4. Configura as variaveis de ambiente de Maquina, copia o app pra
   `C:\Apps\GestaoComercial`, restringe o firewall a rede privada, registra
   e sobe o servico do Windows `GestaoComercial`.
5. Se a rede atual estiver marcada "Publica" no Windows, avisa e pede
   confirmacao antes de continuar -- nao muda a categoria sozinho.
6. Instala o cliente Tailscale (se fornecido) mas NAO faz login -- isso e
   sempre manual, e por design (ver plano da sessao, secao de riscos).

## Depois da instalacao: acesso remoto do responsavel

O dono da loja precisa:
1. Abrir o Tailscale e fazer login com a conta dele.
2. Rodar (PowerShell como Administrador, na pasta `_setup\installer` dentro
   de `C:\Apps\GestaoComercial`, ou onde este README estiver):
   ```
   .\Finish-TailscaleSetup.ps1
   ```

Isso acrescenta o IP do Tailscale ao acesso liberado e reinicia o servico.

## Atualizando um cliente existente

Rode o mesmo `GestaoComercialSetup.exe` (versao nova) na maquina do cliente.
O instalador detecta a instalacao existente e so troca os arquivos do app +
reinicia o servico -- nao toca em banco, segredos, firewall ou Tailscale de
novo.

Alternativa mais rapida (sem gerar um `.exe` novo), se voce tiver acesso
remoto via Tailscale a maquina do cliente: copie o `.output` novo pra la e
rode `Install-GestaoComercial.ps1` direto, apontando `-AppSourceDir` pra
pasta que tem o `.output` atualizado.

## Recuperacao / suporte

- **Log do app**: `C:\ProgramData\GestaoComercial\logs\stdout.log` e
  `stderr.log` -- o NSSM (que gerencia o `node.exe` como servico, ver
  `lib\WindowsService.ps1`) redireciona a saida do processo pra la e faz
  rotacao automatica. Muito mais direto que cavar o Visualizador de Eventos
  do Windows.
- **Senha de superusuario do Postgres**, quando o instalador foi quem
  INSTALOU o Postgres do zero (nao quando ja existia): fica em
  `C:\ProgramData\GestaoComercial\postgres-superuser.txt`, com permissao
  restrita a Administradores. Guarde num cofre de senhas e apague o arquivo
  se quiser.
- **Reinstalar do zero** num cliente com problema grave: rode
  `Uninstall-GestaoComercial.ps1` (sem `-RemoveData`, preserva o banco) e
  depois o `GestaoComercialSetup.exe` de novo.

## Limitacoes conhecidas (v1)

- A GUI WPF (`installer-gui\`) ja foi validada de ponta a ponta na loja
  piloto: elevacao via UAC, o campo de confirmacao de rede publica (via
  sentinela), log ao vivo, registro do servico via NSSM e o app respondendo
  em `http://localhost:8080` no final. O campo de senha do Postgres (so
  aparece quando ja existe uma instancia previa) ainda nao foi exercitado
  numa instalacao nova de verdade -- so o caminho "banco ja configurado" foi
  testado ate agora.
- So testado em Windows 11 com Postgres ja instalado previamente (a loja
  piloto do Victor). O caminho de instalar Postgres do zero
  (`Install-PostgresSilently`) ainda precisa de um teste real numa maquina
  limpa antes de confiar nele com um cliente.
- Se o PC do cliente ja tiver uma instancia Postgres servindo OUTRO sistema
  (aconteceu com a Nexo Financas na maquina do Victor), o instalador cria a
  role/banco dele dentro da instancia existente, mas precisa que voce digite
  a senha de superusuario dessa instancia -- nao ha como automatizar isso
  sem conhecer essa senha de antemao.
- Nao ha uma tailnet compartilhada entre clientes para suporte remoto
  centralizado -- cada loja usa a propria conta Tailscale. Ver plano da
  sessao para o design (nao implementado) dessa ideia como melhoria futura.
