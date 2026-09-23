-- Convite por link com token, em vez de "quem entrar com este e-mail".
--
-- O cadastro nao confere posse do e-mail, entao casar convite por e-mail
-- entregava o papel convidado (gerente, admin) a quem cadastrasse aquele
-- endereco primeiro. Agora so o portador do link aceita.
--
-- Guarda-se o HASH do token: quem le o banco (backup, suporte) nao ganha
-- links utilizaveis. Convites antigos, sem token, deixam de ser aceitaveis
-- -- e o comportamento correto: eram justamente os sequestraveis.

alter table pending_invites add column if not exists token_hash text;
alter table pending_invites add column if not exists expires_at timestamptz;
alter table pending_invites add column if not exists accepted_by text;

create unique index if not exists pending_invites_token_idx
  on pending_invites (token_hash)
  where token_hash is not null;
