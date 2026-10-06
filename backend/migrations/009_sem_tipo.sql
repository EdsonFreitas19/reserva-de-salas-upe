-- Tipo especial "Sem tipo": para ambientes/áreas que ainda não têm classificação. Não pode ser renomeado nem excluído.
INSERT INTO tipo_ambiente (nome, cor) VALUES ('Sem tipo', '#f3f4f6') ON CONFLICT (nome) DO NOTHING;
