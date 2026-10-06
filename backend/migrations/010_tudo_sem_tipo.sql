-- Pedido do administrador: todos os ambientes e áreas do mapa começam como "Sem tipo" (o tipo será cadastrado manualmente).
UPDATE ambiente SET tipo = 'Sem tipo' WHERE tipo <> 'Sem tipo';
UPDATE mapa_area SET tipo = 'Sem tipo' WHERE tipo <> 'Sem tipo';
