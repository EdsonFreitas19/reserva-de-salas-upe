-- Modelo do MVP (ver documento "Modelagem do Banco de Dados")
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE papel AS ENUM ('USUARIO', 'AUTORIDADE', 'ADMIN');
CREATE TYPE status_reserva AS ENUM ('PENDENTE', 'APROVADA', 'RECUSADA', 'CANCELADA');

CREATE TABLE usuario (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome       VARCHAR(150) NOT NULL,
  email      VARCHAR(150) NOT NULL UNIQUE,
  google_id  VARCHAR(100) NOT NULL UNIQUE,
  ativo      BOOLEAN NOT NULL DEFAULT true,
  criado_em  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuario_papel (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  BIGINT NOT NULL REFERENCES usuario(id),
  papel       papel NOT NULL,
  UNIQUE (usuario_id, papel)
);

CREATE TABLE ambiente (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome        VARCHAR(150) NOT NULL,
  tipo        VARCHAR(60) NOT NULL,
  capacidade  INTEGER,
  localizacao VARCHAR(150),
  ativo       BOOLEAN NOT NULL DEFAULT true,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ambiente_autoridade (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente_id BIGINT NOT NULL REFERENCES ambiente(id),
  usuario_id  BIGINT NOT NULL REFERENCES usuario(id),
  UNIQUE (ambiente_id, usuario_id)
);

CREATE TABLE reserva (
  id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente_id          BIGINT NOT NULL REFERENCES ambiente(id),
  solicitante_id       BIGINT NOT NULL REFERENCES usuario(id),
  inicio               TIMESTAMPTZ NOT NULL,
  fim                  TIMESTAMPTZ NOT NULL,
  finalidade           VARCHAR(300) NOT NULL,
  status               status_reserva NOT NULL DEFAULT 'PENDENTE',
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT now(),   -- relógio do servidor/banco (RN09)
  decidido_por_id      BIGINT REFERENCES usuario(id),
  decidido_em          TIMESTAMPTZ,
  justificativa_recusa VARCHAR(300),
  CHECK (fim > inicio),
  CHECK (status <> 'RECUSADA' OR justificativa_recusa IS NOT NULL),
  -- RN01/RN02/RNF04: duas reservas APROVADAS do mesmo ambiente não podem se sobrepor.
  -- '[)' => 14–16h e 16–18h NÃO conflitam.
  CONSTRAINT reserva_sem_conflito EXCLUDE USING gist (
    ambiente_id WITH =,
    tstzrange(inicio, fim, '[)') WITH &&
  ) WHERE (status = 'APROVADA')
);
CREATE INDEX reserva_ambiente_inicio_idx ON reserva (ambiente_id, inicio);
CREATE INDEX reserva_solicitante_idx ON reserva (solicitante_id);

CREATE TABLE historico_status (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  reserva_id      BIGINT NOT NULL REFERENCES reserva(id),
  status_anterior status_reserva,
  status_novo     status_reserva NOT NULL,
  autor_id        BIGINT NOT NULL REFERENCES usuario(id),
  motivo          VARCHAR(300),
  criado_em       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RF15: notificação simples in-app
CREATE TABLE notificacao (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id  BIGINT NOT NULL REFERENCES usuario(id),
  reserva_id  BIGINT REFERENCES reserva(id),
  mensagem    VARCHAR(300) NOT NULL,
  lida        BOOLEAN NOT NULL DEFAULT false,
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notificacao_usuario_idx ON notificacao (usuario_id, lida);

-- RNF06: o histórico é imutável (impede UPDATE/DELETE)
CREATE FUNCTION historico_imutavel() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'historico_status é imutável';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER historico_status_imutavel
  BEFORE UPDATE OR DELETE ON historico_status
  FOR EACH ROW EXECUTE FUNCTION historico_imutavel();
