-- O administrador só designa responsáveis; não decide reservas.
DELETE FROM ambiente_autoridade
 WHERE usuario_id IN (SELECT usuario_id FROM usuario_papel WHERE papel = 'ADMIN');
DELETE FROM usuario_papel
 WHERE papel = 'AUTORIDADE'
   AND NOT EXISTS (SELECT 1 FROM ambiente_autoridade aa WHERE aa.usuario_id = usuario_papel.usuario_id);
