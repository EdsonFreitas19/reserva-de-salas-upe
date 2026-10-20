-- "Excluir" uma reserva da lista "Minhas reservas": só some para quem pediu; o histórico continua para a autoridade e o administrador.
ALTER TABLE reserva ADD COLUMN IF NOT EXISTS oculta_solicitante BOOLEAN NOT NULL DEFAULT false;
