-- O tipo de uma área ligada a um ambiente é o do ambiente: corrige áreas que ficaram com um tipo antigo
-- (isso impedia excluir o tipo antigo mesmo sem ambiente nenhum usando).
UPDATE mapa_area m SET tipo = a.tipo FROM ambiente a WHERE m.ambiente_id = a.id AND m.tipo <> a.tipo;
