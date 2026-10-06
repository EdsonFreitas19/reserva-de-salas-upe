-- Horários em que o ambiente está ocupado por outro motivo (aulas fixas, manutenção, feriado...).
-- Cadastrados pelo administrador. Não são reservas: não passam por aprovação e não têm histórico.
--
-- Uma linha = um padrão semanal: "dias_semana" (1=seg ... 5=sex, padrão ISO), das hora_inicio às hora_fim,
-- valendo de data_inicio até data_fim (ex.: o semestre). Para um dia só, use data_inicio = data_fim.
-- As horas são o horário local (America/Recife), como a pessoa enxerga na parede.
CREATE TABLE bloqueio (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  ambiente_id BIGINT NOT NULL REFERENCES ambiente(id) ON DELETE CASCADE,
  descricao   VARCHAR(150) NOT NULL,
  dias_semana SMALLINT[] NOT NULL,
  hora_inicio TIME NOT NULL,
  hora_fim    TIME NOT NULL,
  data_inicio DATE NOT NULL,
  data_fim    DATE NOT NULL,
  criado_por  BIGINT REFERENCES usuario(id),
  criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (hora_fim > hora_inicio),
  CHECK (data_fim >= data_inicio),
  CHECK (cardinality(dias_semana) BETWEEN 1 AND 5),
  CHECK (dias_semana <@ ARRAY[1,2,3,4,5]::smallint[])
);
CREATE INDEX bloqueio_ambiente_idx ON bloqueio (ambiente_id, data_inicio, data_fim);

-- Devolve a descrição do horário ocupado que colide com [p_inicio, p_fim), ou NULL se não houver colisão.
-- Reservas começam e terminam no mesmo dia (regra da aplicação), então basta olhar o dia local do início.
CREATE FUNCTION bloqueio_conflitante(p_ambiente BIGINT, p_inicio TIMESTAMPTZ, p_fim TIMESTAMPTZ)
RETURNS TEXT AS $$
  SELECT b.descricao
    FROM bloqueio b
   WHERE b.ambiente_id = p_ambiente
     AND (p_inicio AT TIME ZONE 'America/Recife')::date BETWEEN b.data_inicio AND b.data_fim
     AND EXTRACT(ISODOW FROM (p_inicio AT TIME ZONE 'America/Recife'))::int = ANY (b.dias_semana)
     AND b.hora_inicio < (p_fim    AT TIME ZONE 'America/Recife')::time
     AND b.hora_fim    > (p_inicio AT TIME ZONE 'America/Recife')::time
   ORDER BY b.hora_inicio
   LIMIT 1
$$ LANGUAGE sql STABLE;
