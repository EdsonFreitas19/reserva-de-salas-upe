-- Regras de reserva que o administrador ajusta pela tela (uma única linha):
--   periodo_max_meses : até quantos meses à frente (a partir de hoje) alguém pode reservar
--   duracao_max_horas : duração máxima de uma reserva, em horas
CREATE TABLE IF NOT EXISTS configuracao (
  id                SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  periodo_max_meses SMALLINT NOT NULL DEFAULT 1 CHECK (periodo_max_meses BETWEEN 1 AND 24),
  duracao_max_horas SMALLINT NOT NULL DEFAULT 4 CHECK (duracao_max_horas BETWEEN 1 AND 24)
);
INSERT INTO configuracao (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Sábado e domingo agora também aceitam reservas: os horários ocupados podem usar os dias 6 e 7 (ISO).
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
            WHERE conrelid = 'bloqueio'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%dias_semana%'
  LOOP
    EXECUTE format('ALTER TABLE bloqueio DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE bloqueio ADD CONSTRAINT bloqueio_dias_semana_check
  CHECK (cardinality(dias_semana) BETWEEN 1 AND 7 AND dias_semana <@ ARRAY[1,2,3,4,5,6,7]::smallint[]);
