-- Tabela pro rate limit do Better Auth virar persistente (banco, não memória).
--
-- O QUE ESTAVA ERRADO
--
-- Better Auth já vem com rate limit ligado em produção por padrão (3
-- tentativas de sign-in/sign-up a cada 10s), mas a trava fica num `Map()`
-- em memória do processo Node quando nenhum `storage`/`secondaryStorage` é
-- configurado -- que é exatamente o estado deste projeto até agora. Numa
-- instalação on-premise (um processo Node só, sempre o mesmo) isso até
-- funcionava. No Vercel (funções serverless, várias instâncias
-- concorrentes, cada uma podendo nascer do zero a qualquer momento) esse
-- `Map()` morre e reinicia o tempo todo -- a trava vira decorativa, não
-- impede nada de verdade. Achado revisando o sistema depois de abrir o
-- cadastro público (ver HANDOFF.md, item 127): agora que qualquer um na
-- internet alcança `/sign-in`/`/sign-up`, essa trava precisa funcionar de
-- verdade.
--
-- Tabela gerada no formato que o próprio Better Auth espera do adapter
-- Postgres pro modelo "rateLimit" (mesmo padrão camelCase/aspas duplas de
-- `0001_auth.sql`, que é gerado pela CLI dele e não deve ser editado à
-- mão -- essa tabela nova segue a mesma convenção por consistência, mas
-- não foi gerada pela CLI). `lastRequest` é `bigint` porque guarda
-- milissegundos desde epoch (Date.now()), que já estoura um `integer`
-- normal.

create table if not exists "rateLimit" (
  "id" text not null primary key,
  "key" text not null,
  "count" integer,
  "lastRequest" bigint
);

create index if not exists "rateLimit_key_idx" on "rateLimit" ("key");
