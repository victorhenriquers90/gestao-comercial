-- Meta nao tinha como ser excluida: criada com o periodo, a loja ou o
-- vendedor errado, ficava presa na tela de Metas para sempre -- o unico
-- jeito de tirar do caminho era editar por cima (mudar o periodo pro
-- passado, por exemplo), o que distorce o historico em vez de corrigi-lo.
-- Mesmo padrao de soft delete que customers/products/suppliers ja usam.

alter table targets add column if not exists deleted_at timestamptz;
