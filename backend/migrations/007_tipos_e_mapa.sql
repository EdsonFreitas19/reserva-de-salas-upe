-- Tipos de ambiente (catálogo com cor), usados pelos ambientes e pelo mapa; e restauração das áreas do mapa original que estejam faltando.
CREATE TABLE tipo_ambiente (
  id    BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome  VARCHAR(40) NOT NULL UNIQUE,
  cor   CHAR(7) NOT NULL CHECK (cor ~ '^#[0-9a-fA-F]{6}$')
);
INSERT INTO tipo_ambiente (nome, cor) VALUES
  ('Sala de aula', '#dbe8f7'), ('Laboratório', '#dff2df'), ('Administrativo', '#fbe9c8'),
  ('Espaço de uso comum', '#f3dff0'), ('Serviços', '#ececec');

-- valores soltos de dados de exemplo antigos passam para os tipos do catálogo
UPDATE ambiente a SET tipo = m.tipo FROM mapa_area m
 WHERE m.ambiente_id = a.id AND a.tipo IN ('Sala', 'Auditório', 'LAMIE');
UPDATE ambiente SET tipo = 'Sala de aula' WHERE tipo = 'Sala';
UPDATE ambiente SET tipo = 'Espaço de uso comum' WHERE tipo = 'Auditório';
UPDATE ambiente SET tipo = 'Laboratório' WHERE tipo = 'LAMIE';

-- qualquer outro tipo já em uso (digitado antes) entra no catálogo com cinza
INSERT INTO tipo_ambiente (nome, cor)
  SELECT DISTINCT left(t, 40), '#e5e7eb' FROM (SELECT tipo AS t FROM ambiente UNION SELECT tipo FROM mapa_area) x
   WHERE t NOT IN (SELECT nome FROM tipo_ambiente);
UPDATE ambiente SET tipo = left(tipo, 40) WHERE length(tipo) > 40;
UPDATE mapa_area SET tipo = left(tipo, 40) WHERE length(tipo) > 40;

ALTER TABLE ambiente ALTER COLUMN tipo TYPE VARCHAR(40);
ALTER TABLE mapa_area ALTER COLUMN tipo TYPE VARCHAR(40);
ALTER TABLE ambiente ADD CONSTRAINT ambiente_tipo_fk FOREIGN KEY (tipo) REFERENCES tipo_ambiente(nome) ON UPDATE CASCADE;
ALTER TABLE mapa_area ADD CONSTRAINT mapa_area_tipo_fk FOREIGN KEY (tipo) REFERENCES tipo_ambiente(nome) ON UPDATE CASCADE;

-- recoloca no mapa as áreas do desenho original que não existem mais (pelo número); as demais não são tocadas
INSERT INTO mapa_area (numero, rotulo, tipo, pontos)
  SELECT p.numero, p.rotulo, p.tipo, p.pontos FROM (VALUES
    (1, 'NTI', 'Administrativo', '[[512, 151], [574, 151], [574, 211], [512, 211]]'::jsonb),
    (2, 'Banheiro', 'Serviços', '[[410, 151], [512, 151], [512, 211], [410, 211]]'::jsonb),
    (3, 'Laboratório 01', 'Laboratório', '[[288, 151], [410, 151], [410, 211], [288, 211]]'::jsonb),
    (4, 'Sala integrada', 'Sala de aula', '[[210, 151], [288, 151], [288, 211], [210, 211]]'::jsonb),
    (5, 'Sala de aula 03', 'Sala de aula', '[[138, 151], [210, 151], [210, 211], [138, 211]]'::jsonb),
    (6, 'Sala de aula 02', 'Sala de aula', '[[30, 131], [138, 131], [138, 211], [30, 211]]'::jsonb),
    (7, 'Sala de aula 01', 'Sala de aula', '[[30, 40], [138, 40], [138, 131], [30, 131]]'::jsonb),
    (8, 'Sala de convivência', 'Espaço de uso comum', '[[138, 40], [210, 40], [210, 100], [138, 100]]'::jsonb),
    (9, 'PPGEC', 'Administrativo', '[[210, 40], [288, 40], [288, 100], [210, 100]]'::jsonb),
    (10, 'Laboratório 02', 'Laboratório', '[[288, 40], [410, 40], [410, 100], [288, 100]]'::jsonb),
    (11, 'Biblioteca', 'Espaço de uso comum', '[[410, 40], [512, 40], [512, 100], [410, 100]]'::jsonb),
    (12, 'inLab', 'Laboratório', '[[512, 40], [574, 40], [574, 100], [512, 100]]'::jsonb),
    (13, 'Auditório', 'Espaço de uso comum', '[[640, 40], [845, 40], [845, 100], [640, 100]]'::jsonb),
    (14, 'Escolaridade', 'Administrativo', '[[845, 40], [926, 40], [926, 100], [845, 100]]'::jsonb),
    (15, 'Sala dos professores', 'Administrativo', '[[926, 40], [1064, 40], [1064, 211], [974, 211], [974, 100], [926, 100]]'::jsonb),
    (16, 'Cozinha', 'Serviços', '[[926, 151], [974, 151], [974, 211], [926, 211]]'::jsonb),
    (17, 'DotLab + PPGEC', 'Laboratório', '[[845, 151], [926, 151], [926, 211], [845, 211]]'::jsonb),
    (18, 'LAMIE', 'Laboratório', '[[640, 151], [845, 151], [845, 211], [640, 211]]'::jsonb)
  ) AS p(numero, rotulo, tipo, pontos)
 WHERE p.numero NOT IN (SELECT numero FROM mapa_area WHERE numero IS NOT NULL);
UPDATE mapa_area m SET ambiente_id = a.id
  FROM (SELECT DISTINCT ON (lower(nome)) id, nome FROM ambiente ORDER BY lower(nome), id) a
 WHERE m.ambiente_id IS NULL AND lower(a.nome) = lower(m.rotulo)
   AND NOT EXISTS (SELECT 1 FROM mapa_area x WHERE x.ambiente_id = a.id);
