import { pool } from './db.js';
import { migrate } from './migrate.js';

/** Dados de exemplo para desenvolvimento. Pode rodar várias vezes. */
async function seed() {
  await migrate();
  // Só dois logins de teste: Admin Demo e Usuário Demo. Versões antigas tinham outros (Aluno/Professor/Autoridade Demo,
  // Usuário Demo 1/2): o primeiro que existir é renomeado para "Usuário Demo" (mantém reservas e responsabilidades) e os
  // demais ficam inativos, para não aparecerem na tela de login de teste.
  const antigos = ['usuario1@upe.br', 'autoridade@upe.br', 'professor@upe.br', 'usuario2@upe.br', 'aluno@upe.br'];
  for (const de of antigos)
    await pool.query(
      `UPDATE usuario SET nome = 'Usuário Demo', email = 'usuario@upe.br', google_id = 'dev-usuario@upe.br'
        WHERE email = $1 AND NOT EXISTS (SELECT 1 FROM usuario WHERE email = 'usuario@upe.br')`,
      [de],
    );
  await pool.query(
    `UPDATE usuario SET ativo = false WHERE google_id LIKE 'dev-%' AND email NOT IN ('admin@upe.br', 'usuario@upe.br')`,
  );
  // Qualquer usuário pode ser autoridade de salas: o administrador é quem indica. O papel AUTORIDADE é só uma marca
  // automática de quem responde por alguma sala (aqui, o Usuário Demo responde pelas salas de exemplo).
  const users = [
    ['Admin Demo', 'admin@upe.br', ['USUARIO', 'ADMIN']],
    ['Usuário Demo', 'usuario@upe.br', ['USUARIO', 'AUTORIDADE']],
  ] as const;
  const ids: Record<string, number> = {};
  for (const [nome, email, papeis] of users) {
    const r = await pool.query(
      `INSERT INTO usuario (nome, email, google_id) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome, ativo = true RETURNING id`,
      [nome, email, `dev-${email}`],
    );
    ids[email] = r.rows[0].id;
    for (const p of papeis)
      await pool.query('INSERT INTO usuario_papel (usuario_id, papel) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ids[email], p]);
  }
  const { rowCount } = await pool.query('SELECT 1 FROM ambiente');
  if (!rowCount) {
    const ambientes = [
      ['Laboratório de Informática 1', 'Laboratório', 30, 'Bloco A, 1º andar'],
      ['Auditório', 'Espaço de uso comum', 150, 'Bloco Central'],
      ['LAMIE', 'Laboratório', 20, 'Bloco B, térreo'],
      ['Sala 101', 'Sala de aula', 40, 'Bloco A, 1º andar'],
    ];
    for (const [nome, tipo, cap, loc] of ambientes) {
      await pool.query('INSERT INTO ambiente (nome, tipo, capacidade, localizacao) VALUES ($1,$2,$3,$4)', [nome, tipo, cap, loc]);
    }
  }
  // Ambientes de exemplo sem responsável passam para o Usuário Demo (sem responsável ninguém aprova reservas da sala).
  await pool.query(
    `INSERT INTO ambiente_autoridade (ambiente_id, usuario_id)
     SELECT a.id, $1 FROM ambiente a
      WHERE NOT EXISTS (SELECT 1 FROM ambiente_autoridade x WHERE x.ambiente_id = a.id)`,
    [ids['usuario@upe.br']],
  );
  // Horários ocupados de exemplo (aulas fixas do laboratório) para o próximo semestre
  const temBloqueio = await pool.query('SELECT 1 FROM bloqueio LIMIT 1');
  if (!temBloqueio.rowCount) {
    const exemplos: [string, number[], string, string][] = [
      ['Aula de Programação (Turma A)', [1, 3], '08:00', '10:00'],
      ['Aula de Banco de Dados (Turma B)', [2, 4], '14:00', '16:00'],
    ];
    for (const [desc, dias, ini, fim] of exemplos)
      await pool.query(
        `INSERT INTO bloqueio (ambiente_id, descricao, dias_semana, hora_inicio, hora_fim, data_inicio, data_fim)
         SELECT id, $1, $2::smallint[], $3, $4, CURRENT_DATE, CURRENT_DATE + 120
           FROM ambiente WHERE nome = 'Laboratório de Informática 1'`,
        [desc, dias, ini, fim],
      );
  }
  console.log('Seed concluído. Usuários de teste: admin@upe.br e usuario@upe.br');
}

seed().then(() => pool.end()).catch((e) => { console.error(e); process.exit(1); });
