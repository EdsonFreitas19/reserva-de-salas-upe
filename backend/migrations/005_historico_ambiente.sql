-- O histórico guarda o NOME do ambiente na época da reserva: o ambiente pode ser renomeado ou excluído
-- sem perder (nem alterar) o que foi registrado.
ALTER TABLE reserva ADD COLUMN ambiente_nome VARCHAR(120);
UPDATE reserva r SET ambiente_nome = a.nome FROM ambiente a WHERE a.id = r.ambiente_id;
ALTER TABLE reserva ALTER COLUMN ambiente_nome SET NOT NULL;

ALTER TABLE reserva ALTER COLUMN ambiente_id DROP NOT NULL;
ALTER TABLE reserva DROP CONSTRAINT reserva_ambiente_id_fkey;
ALTER TABLE reserva ADD CONSTRAINT reserva_ambiente_id_fkey
  FOREIGN KEY (ambiente_id) REFERENCES ambiente(id) ON DELETE SET NULL;

CREATE FUNCTION reserva_guarda_nome_ambiente() RETURNS trigger AS $$
BEGIN
  SELECT nome INTO NEW.ambiente_nome FROM ambiente WHERE id = NEW.ambiente_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
-- (ambiente_nome é NOT NULL: o trigger BEFORE INSERT preenche antes da checagem)
CREATE TRIGGER reserva_guarda_nome_ambiente BEFORE INSERT ON reserva
  FOR EACH ROW EXECUTE FUNCTION reserva_guarda_nome_ambiente();
