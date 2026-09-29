-- Remove o registro orfao "0022_nfce_foundation.sql" da tabela _migrations.
--
-- Em algum momento uma migration com esse nome foi aplicada direto neste
-- banco e nunca chegou a existir como arquivo no repositorio -- o arquivo
-- real que cobre NFC-e e 0022_nfce.sql, outro conteudo. O build avisa hoje
-- "migration(s) registrada(s) sem arquivo" por causa dela. Isto so apaga o
-- registro de controle; nenhuma tabela ou coluna e tocada.
delete from _migrations where name = '0022_nfce_foundation.sql';
