-- Mapa 2D do campus (áreas editáveis pelo administrador) e fotos dos ambientes.
CREATE TABLE mapa_area (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  numero      SMALLINT,
  rotulo      VARCHAR(80) NOT NULL,
  tipo        VARCHAR(40) NOT NULL DEFAULT 'Sala de aula',
  pontos      JSONB NOT NULL,                       -- polígono: [[x,y], ...] em unidades do desenho (1094 x 251)
  ambiente_id BIGINT UNIQUE REFERENCES ambiente(id) ON DELETE SET NULL,  -- uma área por ambiente
  CHECK (jsonb_typeof(pontos) = 'array' AND jsonb_array_length(pontos) >= 3)
);

CREATE TABLE ambiente_foto (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente_id BIGINT NOT NULL REFERENCES ambiente(id) ON DELETE CASCADE,
  arquivo     VARCHAR(80) NOT NULL UNIQUE,          -- nome do arquivo na pasta de uploads
  mime        VARCHAR(30) NOT NULL,
  tamanho     INTEGER NOT NULL,
  criado_por  BIGINT REFERENCES usuario(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ambiente_foto_ambiente_idx ON ambiente_foto (ambiente_id, id);

INSERT INTO mapa_area (numero, rotulo, tipo, pontos) VALUES
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
  (18, 'LAMIE', 'Laboratório', '[[640, 151], [845, 151], [845, 211], [640, 211]]'::jsonb);

-- Liga automaticamente as áreas cujo nome é igual ao de um ambiente já cadastrado
UPDATE mapa_area m SET ambiente_id = a.id
  FROM (SELECT DISTINCT ON (lower(nome)) id, nome FROM ambiente ORDER BY lower(nome), id) a
 WHERE lower(a.nome) = lower(m.rotulo);
