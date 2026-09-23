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
  apaga o banco de dados nem os segredos (precisa de `-RemoveData` explicito),
  e nem mesmo `-RemoveData` apaga os backups (precisa de `-RemoveBackups`).
- `Backup-GestaoComercial.ps1` -- backup do banco. E o que a tarefa agendada
  diaria chama; tambem roda na mao antes de algo arriscado.
- `Set-BackupSecondaryDir.ps1` -- muda a pasta da copia de backup fora do
  disco do banco, sem reinstalar nada.
- `Restore-GestaoComercial.ps1` -- restauracao a partir de um backup.
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
7. Agenda o backup diario do banco e ja roda um na hora, pra falha de
   configuracao aparecer na frente de quem instalou.

## Primeiro acesso e equipe

O cadastro e fechado. So duas contas podem ser criadas:

- **A primeira do servidor**, em `/login?cadastro`. Ela vira a dona da
  empresa (administrador). Crie-a logo depois de instalar, com o dono da
  loja do lado -- enquanto ela nao existe, quem abrir esse endereco primeiro
  vira o dono.
- **Quem tem link de convite.** Em Configuracoes > Equipe o administrador
  gera o link (vale 7 dias, uma pessoa so) e manda por WhatsApp. O link e o
  que da acesso, nao o e-mail: o cadastro nao confere posse de e-mail, entao
  convite "por e-mail" entregava o papel a quem cadastrasse o endereco
  primeiro.

Quem entra sem convite ve "Peca ao administrador um link de convite" e nao
ganha empresa. Link perdido ou vencido: "Novo link" na lista de convites
pendentes (o antigo para de valer).

A instalacao comeca **sem dados de demonstracao** (`GC_DEMO_SEED` vazio).

## Backup e restauracao

O backup diario roda as 22:30 pela tarefa do Windows `GestaoComercial-Backup`
(usuario SYSTEM, com `-StartWhenAvailable` -- se a loja estava desligada no
horario, roda na proxima vez que ligar). Os arquivos ficam em
`C:\ProgramData\GestaoComercial\backups`, retencao de 30 dias com piso de 7
copias, e o log em `logs\backup.log`.

Todo backup e **verificado antes de virar backup**: o dump e escrito como
`.partial` e so ganha o nome definitivo depois que o `pg_restore` consegue
ler o indice e as tabelas criticas (`sales`, `payments`, `cash_movements`...)
aparecem nele. Backup corrompido e pior que backup nenhum -- da a sensacao de
estar protegido ate o dia em que precisa.

Numa **atualizacao**, o instalador tira um backup ANTES de trocar arquivos e
rodar migrations, e **interrompe a atualizacao** se esse backup falhar. E
deliberado: uma loja que continua na versao antiga nao perde nada; uma que
atualiza sem rede de seguranca nao tem pra onde voltar. `-SkipPreUpdateBackup`
existe como valvula de escape consciente.

### Copia fora da maquina (importante)

Por padrao o backup fica **no mesmo disco do banco**. Isso protege contra
erro de operacao e migration ruim, mas **nao** contra o disco falhar.

Pra configurar (ou trocar) o destino, num PowerShell **como
administrador**:

```powershell
.\Set-BackupSecondaryDir.ps1 -SecondaryDir "D:\backups-gestao"
```

Serve outro disco, pendrive, HD externo ou pasta de rede. O script confere
que da pra escrever la **na hora**, avisa se o destino estiver no mesmo
disco do banco (o que nao protege contra o disco morrer), e so reescreve a
tarefa agendada -- nao mexe no app, nao para o servico, nao roda migration.
Antes disso, trocar de pendrive exigia reinstalar o sistema inteiro: risco
demais pra mudar um caminho, e risco demais e o que faz a mudanca nunca ser
feita.

Pra voltar a ter so a copia local: `.\Set-BackupSecondaryDir.ps1 -Remover`.

Na instalacao inicial da pra ja passar o destino:

```powershell
.\Install-GestaoComercial.ps1 -AppSourceDir <pasta> -BackupSecondaryDir "D:\backups-gestao"
```

**Se a copia externa falhar, o backup local ainda e salvo** -- um pendrive
fora do lugar nao pode significar "hoje nao teve backup". Mas a falha
**nao some**: o resultado da copia vai pro `last-backup.json` e a tela de
Configuracoes passa a mostrar ha quanto tempo a copia nao sai, com o erro do
sistema operacional junto.

Isso importa mais do que parece. A tarefa roda por SYSTEM, de madrugada, sem
ninguem olhando: antes, a falha da copia virava um `Write-Warning` que
ninguem leria nunca, e o backup diario continuava dizendo OK. A loja passaria
meses acreditando ter copia fora da maquina sem ter. O backup local em dia e
exatamente o que faz ninguem reparar que a copia parou.

A copia tambem e **conferida por tamanho** depois de gravada: `Copy-Item`
nao reclama de copia truncada por disco cheio ou pendrive arrancado no meio,
e um arquivo pela metade la fora e pior que arquivo nenhum -- da a sensacao
de ter copia.

### Ensaio de restauracao (faca todo mes)

```powershell
.\Restore-GestaoComercial.ps1 -Ensaio
```

Restaura o backup mais recente **de verdade** -- tabelas, indices,
constraints e dados -- num schema descartavel do proprio banco, dentro de
uma transacao que termina em ROLLBACK. Nao para a loja, nao precisa de
superusuario e nao deixa nada pra tras. No fim mostra quantas tabelas,
indices e constraints entraram, e lista **so** as tabelas cuja contagem
divergiu da producao.

Rodado pela primeira vez em 22/09/2026, contra o backup daquele dia: 47
tabelas, 143 indices, 183 constraints, e a unica divergencia foi
`_migrations` (28 no backup contra 29 em producao) -- esperado, porque uma
migration entrou depois do backup. Testado tambem com um dump truncado de
proposito: o ensaio recusa, explica por que, e sai com codigo 1.

Ate aqui o unico ensaio documentado era restaurar num banco separado, que
exige `CREATE DATABASE` -- e a role do app nao tem essa permissao. Ou
seja: o unico ensaio documentado era o que o dono da loja **nao conseguia
rodar**, e por isso nunca foi rodado. Backup que nunca foi restaurado e so
um arquivo grande.

O que o ensaio em schema **nao** cobre, e fica dito em vez de subentendido:
`CREATE DATABASE`, dono/privilegios do banco novo e a extensao `pg_trgm`
(ja instalada e compartilhada entre schemas). Pra cobrir isso tambem, com o
superusuario em maos:

```powershell
psql -U postgres -c "CREATE DATABASE ensaio_restauracao OWNER gestao_app"
.\Restore-GestaoComercial.ps1 -TargetDatabase ensaio_restauracao
```

### Restaurar

```powershell
# Usa o backup mais recente, por cima do banco de producao:
.\Restore-GestaoComercial.ps1 -Force
```

Exige `-Force` **e** digitar o nome do banco pra confirmar; para o servico
antes e sobe depois; e salva um `pre_restauracao_*.dump` do estado atual
antes de sobrescrever, pra que escolher o arquivo errado nao seja definitivo.

### Ensaio (faca pelo menos uma vez)

Um backup que nunca foi restaurado e so um arquivo grande. Com a loja
tranquila, crie um banco descartavel (precisa do superusuario do Postgres,
entao e voce quem roda) e restaure nele:

```powershell
psql -U postgres -c "CREATE DATABASE ensaio_restauracao OWNER gestao_app"
.\Restore-GestaoComercial.ps1 -TargetDatabase ensaio_restauracao
```

Nada do banco de producao e tocado, e voce descobre ANTES da emergencia se o
backup presta.

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
