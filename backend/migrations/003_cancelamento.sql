-- Quem cancelou a reserva, quando e por quê (cancelamento pelo solicitante OU pela autoridade do ambiente).
ALTER TABLE reserva
  ADD COLUMN cancelado_por_id     BIGINT REFERENCES usuario(id),
  ADD COLUMN cancelado_em         TIMESTAMPTZ,
  ADD COLUMN motivo_cancelamento  VARCHAR(300);

-- Reservas já canceladas: recupera quem/quando/motivo a partir do histórico imutável
UPDATE reserva r
   SET cancelado_por_id = h.autor_id, cancelado_em = h.criado_em, motivo_cancelamento = h.motivo
  FROM historico_status h
 WHERE h.reserva_id = r.id AND h.status_novo = 'CANCELADA' AND r.status = 'CANCELADA';
