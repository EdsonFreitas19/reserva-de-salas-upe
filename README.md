# Sistema de Reserva de Ambientes — UPE Campus Caruaru (MVP)

Consulta de disponibilidade e solicitação de reserva de ambientes (laboratórios, salas, auditório, LAMIE) com aprovação por um responsável (autoridade) da sala e **garantia de não haver reservas conflitantes, mesmo com pedidos simultâneos** (a regra vive no banco, via `EXCLUSION CONSTRAINT` do PostgreSQL).

**Stack:** TypeScript · React + Vite · Node.js + Fastify · PostgreSQL 16 · Google OAuth (OIDC) · Vitest

---

## 1. O que você precisa ter instalado

| Item | Versão | Observação |
|---|---|---|
| Node.js | 20 ou superior | https://nodejs.org (vem com o npm) |
| Docker Desktop | qualquer recente | para subir o PostgreSQL. *Alternativa:* PostgreSQL 14+ instalado à mão (veja o final do passo 3) |

## 2. Rodar em 4 comandos

Abra um terminal **na pasta do projeto** (a que contém este README):

```bash
npm install          # instala o "concurrently" da raiz
npm run setup        # instala back-end e front-end e cria backend/.env
npm run db:up        # sobe o PostgreSQL no Docker (porta 5433)
npm run seed         # cria as tabelas e os dados de exemplo
npm run dev          # inicia API (porta 3001) e site (porta 5173)
```

Depois abra **http://localhost:5173**.

No sistema só existem **dois perfis**: **Usuário** (professor ou funcionário da UPE, que reserva salas) e **Administrador**. Ser **autoridade** (responsável por uma sala) não é um perfil à parte: é uma **função que o administrador dá a um usuário**, sala por sala.

**Menu "Aprovações":** aparece para todos os usuários. Quem **não** é responsável por nenhuma sala vê só um aviso ("Você não é responsável por nenhuma sala"). Quem é responsável (o administrador indica) vê quatro abas:

| Aba | O que faz |
|---|---|
| Solicitações pendentes | aprovar ou recusar os pedidos das suas salas (recusa exige justificativa) |
| Reservas aprovadas | cancelar uma reserva aprovada que ainda não começou, informando o motivo (o solicitante é notificado) |
| Minhas salas | administrar as suas salas: cadastrar e remover **horários ocupados** (aulas, manutenção) |
| Usuários | lista de todos os usuários do sistema, com a função de cada um e quantas reservas têm nas suas salas |

Quem é responsável também vê a etiqueta "Responsável por N ambientes" no topo e "Você é responsável" nos cartões das salas. O administrador continua cadastrando ambientes, definindo os responsáveis de cada sala e vendo todas as reservas.

Na tela de login aparece o **"Modo de desenvolvimento"**, com **dois** usuários de teste (sem precisar de Google):

| Usuário de teste | Quem é | O que testar |
|---|---|---|
| Usuário Demo | Usuário comum que **também é responsável** pelas salas de exemplo | reservar salas, e na aba Aprovações aprovar/recusar/cancelar e administrar as salas dele |
| Admin Demo | Administrador (**não aprova reservas** e não pode ser responsável por sala) | cadastrar/editar/desativar/**excluir** ambientes, **designar os responsáveis de cada ambiente** (aba **Usuários**: lista todo mundo e permite escolher a sala de cada pessoa, ou pelo e-mail na aba Ambientes), cadastrar horários ocupados e ver todas as reservas |

**Roteiro rápido (2 logins):** entre como *Usuário Demo* → Ambientes → Auditório → solicite um horário (o Usuário Demo é o responsável das salas de exemplo, então ele mesmo aprova em Aprovações → Pendentes). Entre como *Admin Demo* → Administração → **Usuários** para ver todos e designar quem é responsável por cada sala; o admin não vê botões de aprovar.

**Definir os responsáveis de uma sala:** entre como *Admin* → Administração → na linha do ambiente, "Responsáveis e horários" → digite o e-mail do professor/funcionário (precisa estar na lista de autorizados) e clique em "Adicionar responsável". Pode haver mais de um por sala (basta um aprovar). Se a pessoa nunca entrou no sistema, ela é pré-cadastrada e, ao fazer login com o Google, já aparece como autoridade daquele ambiente. Um professor ou funcionário pode ser autoridade de uma ou mais salas e continuar solicitando reservas nas demais. Ambientes sem responsável não aceitam solicitações.

**Horários ocupados (aulas fixas):** no mesmo painel, o admin cadastra os dias, as horas e o período em que a sala está ocupada; eles aparecem como "Ocupado" na agenda e bloqueiam solicitações.

## 3. Comandos úteis

```bash
npm test             # testes do back-end (inclui o teste de concorrência); usa o banco reserva_upe_test
npm run build        # confere os tipos do back e gera o build do front
npm run db:down      # para o PostgreSQL (os dados ficam guardados no volume Docker)
```

**Sem Docker?** Instale o PostgreSQL 14+, crie usuário e banco e ajuste o `DATABASE_URL` em `backend/.env` (aí a porta é a 5432, a do PostgreSQL instalado):

```sql
CREATE ROLE reserva LOGIN SUPERUSER PASSWORD 'reserva';
CREATE DATABASE reserva_upe OWNER reserva;
```
(depois pule o `npm run db:up`.) O usuário precisa poder executar `CREATE EXTENSION btree_gist` (superusuário serve).

## 4. Ativar o login real com Google (RF01)

O login de teste é só para desenvolvimento. Para usar contas institucionais:

1. Acesse o [Google Cloud Console](https://console.cloud.google.com/) → **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth**.
2. Tipo: **Aplicativo da Web**. Em **Origens JavaScript autorizadas** coloque `http://localhost:5173` (e, depois, o domínio de produção). Não precisa de URI de redirecionamento.
3. Copie o ID do cliente (termina em `.apps.googleusercontent.com`) para `backend/.env`:
   ```
   GOOGLE_CLIENT_ID=SEU_ID.apps.googleusercontent.com
   ALLOWED_DOMAINS=upe.br
   ADMIN_EMAILS=edson.ofreitas@upe.br
   DEV_LOGIN=false
   ```
4. Reinicie o `npm run dev`. O botão "Entrar com o Google" aparece na tela de login.

O servidor valida assinatura e audiência do token do Google. Quem estiver em `ADMIN_EMAILS` vira administrador no primeiro login; os demais entram como Usuário. O sistema não guarda senhas (RNF01).

### Mapa 2D e fotos dos ambientes

- **Mapa** (menu): desenho do campus com as 18 áreas. Qualquer usuário clica numa sala e abre a página dela (fotos, agenda, solicitar reserva). A página do ambiente tem o atalho "📍 Ver no mapa".
- **Administrador → Mapa → ✎ Editar mapa:** clique numa área para editar; arraste para mover; arraste os pontos azuis para mudar tamanho/forma; "＋ Nova área" desenha uma área nova (arraste no mapa). No painel ao lado: número, nome, tipo e **qual ambiente aquela área representa**. Depois clique em **Salvar área**.  Para uma área sem ambiente há o botão **Criar ambiente "…" e ligar** (um de cada vez); ou crie o ambiente em Administração → Ambientes e escolha-o na lista da área. Um ambiente só pode estar em uma área.
- **Fotos:** na página do ambiente o administrador usa "＋ Anexar fotos" (JPG, PNG ou WebP; até 10 por ambiente; a imagem é reduzida no navegador) e o × para remover. Os arquivos ficam em `backend/uploads` (outra pasta: `UPLOADS_DIR` no `.env`). **Faça backup dessa pasta** junto com o banco, e não a apague ao atualizar o projeto.

### Tipos de ambiente e cores do mapa

- O **tipo** de um ambiente (Laboratório, Sala de aula…) **nunca é digitado**: escolhe-se numa lista. No fim da lista há **＋ Adicionar novo tipo…**: informe o nome e **escolha a cor**; o tipo já passa a existir na lista e no mapa (legenda e cor das áreas). Isso vale tanto em Administração → Ambientes quanto no painel da área no editor do mapa.
- **Administração → Tipos de ambiente:** renomear (atualiza todos os ambientes), mudar a cor e excluir (só se nenhum ambiente/área usar).
- **No mapa, a cor de uma área ligada a um ambiente é a do tipo do ambiente.** Mudar o tipo do ambiente (em Administração) muda a cor no mapa; mudar o tipo da área no editor do mapa muda o tipo do ambiente ligado (ao salvar).
- **Restaurar áreas ausentes** (editor do mapa): recoloca as áreas do desenho original que tenham sido apagadas, sem mexer nas outras. A atualização para esta versão já recoloca sozinha as que estiverem faltando.

### Desfazer (Ctrl+Z)

- **Editor do mapa:** tudo o que você faz (mover, redimensionar, desenhar, excluir área, mudar nome/tipo/ambiente) fica num **rascunho** e só vai para o sistema ao clicar em **Salvar alterações**. Enquanto isso, **Ctrl+Z desfaz** (e Ctrl+Y refaz). A tecla **Delete** exclui a área selecionada (e dá para desfazer). **Descartar** volta ao último estado salvo. O navegador avisa se você tentar fechar a página com alterações não salvas.
- **Outras ações do administrador:** ao remover um responsável, remover o acesso de um usuário, remover uma foto, remover um horário ocupado ou ativar/desativar um ambiente, aparece um aviso no canto da tela com o botão **Desfazer** (10 segundos) e o **Ctrl+Z** também funciona.
- **Campos de texto:** o Ctrl+Z normal do navegador continua valendo enquanto você digita.
- **O que não dá para desfazer:** aprovar, recusar e cancelar reservas (já geraram avisos aos envolvidos e ficam no histórico imutável) e **excluir um ambiente** (por isso há uma confirmação antes; para esconder sem perder nada, use Desativar).

### Quem pode entrar

O sistema é só para **professores e funcionários da UPE**:

- **Qualquer e-mail `@upe.br`** entra (domínio em `ALLOWED_DOMAINS`). Contas Google de outros domínios são recusadas.
- **Administrador:** só o e-mail em `ADMIN_EMAILS` (hoje `edson.ofreitas@upe.br`). Quem sai dessa variável deixa de ser administrador na próxima vez que o sistema inicia ou a pessoa entra.
- **Exceções (fora do `@upe.br`):** ficam em **`backend/emails-autorizados.txt`** (um e-mail por linha, `#` para comentário). Hoje: `edsonnn695@gmail.com` e `w.edsonfreitas19@gmail.com`, contas de teste. Salvou, vale na hora, sem reiniciar. Retirar um e-mail da lista tira o acesso na hora, mesmo logado.
- **Pela tela:** em **Administração → Usuários** o admin cadastra um e-mail (entra como exceção no arquivo) e pode remover o acesso de qualquer usuário (ele fica desativado, mesmo sendo `@upe.br`).
- Outro nome/local para o arquivo: `AUTHORIZED_EMAILS_FILE` no `.env`.

> **Atenção ao atualizar o projeto:** ao extrair um zip novo por cima da pasta, o `emails-autorizados.txt` é substituído pelo que veio no zip. Guarde uma cópia da sua lista antes de atualizar.

Qualquer usuário (professor ou funcionário) pode ser **autoridade** de um ou mais ambientes: basta o administrador indicar o e-mail dele em "Responsáveis e horários". Ele continua podendo reservar salas como qualquer outro usuário.

## 5. Como a regra de conflito funciona (RNF04)

`backend/migrations/001_init.sql` cria:

```sql
EXCLUDE USING gist (ambiente_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status = 'APROVADA')
```

- Duas reservas **aprovadas** do mesmo ambiente não podem se sobrepor. Se tentarem, o banco recusa (erro `23P01`) e a API devolve **409** com mensagem amigável.
- `'[)'` significa que 14–16h e 16–18h **não** conflitam.
- A checagem na aplicação (RF06) só dá feedback rápido; quem garante é o banco.
- `criado_em` (prioridade por ordem de chegada, RN09) é sempre o `now()` do banco, nunca do navegador.
- `historico_status` é imutável: um trigger bloqueia `UPDATE`/`DELETE` (RNF06).

O teste `backend/test/reservas.test.ts` dispara 10 aprovações simultâneas do mesmo horário e confirma que só uma passa.

## 6. Decisões provisórias (perguntas do NTI ainda em aberto)

Estão todas em **`backend/src/config.ts`**, no objeto `regras`, para mudar em um só lugar:

| Regra | Valor adotado no MVP |
|---|---|
| RN03 — pendente bloqueia o horário? | **Não.** Só reservas aprovadas bloqueiam; várias pendentes podem coexistir. A autoridade vê um aviso quando há pedidos conflitantes anteriores. |
| RN04 — duração máxima | **4 horas** |
| Dias permitidos | **Somente segunda a sexta**; a reserva começa e termina no mesmo dia |
| Quem pode usar | Apenas **professores e funcionários**: e-mails `@upe.br`, mais as exceções de `backend/emails-autorizados.txt` (contas de teste) |
| Vários responsáveis | Cada ambiente pode ter **vários responsáveis**; basta **um** aprovar. Ao aprovar, pendentes que conflitam são recusadas automaticamente (com aviso ao solicitante) |
| Horários ocupados | O admin cadastra (em *Responsáveis e horários*) aulas e usos fixos por dia da semana/horário/período. Aparecem como **Ocupado** na agenda e bloqueiam novas solicitações |
| Cancelar aprovada | A **autoridade** do ambiente pode cancelar uma reserva **aprovada que ainda não começou**, informando o motivo; o solicitante recebe notificação com o motivo. O admin não cancela |
| Sem intervalo entre reservas | Não há folga obrigatória entre uma reserva e outra |
| RN05 — antecedência mínima | Basta o horário ser no futuro. Cancelamento de aprovada permitido até o início. |
| RN08 — admin decide em qualquer ambiente? | **Não (decidido).** Só a autoridade responsável pelo ambiente aprova/recusa. O admin apenas designa os responsáveis (aba Usuários) e consulta tudo; não pode ser responsável nem aprovar. |
| Ambiente sem responsável | **Não aceita solicitações** (como o admin não aprova, o pedido ficaria parado). O admin precisa definir o responsável primeiro. |
| Excluir ambiente | Pode excluir mesmo com histórico: as reservas antigas continuam aparecendo com o **nome que o ambiente tinha na época**. Só não dá para excluir se houver reservas pendentes/aprovadas ainda por acontecer (recuse ou cancele antes). Ao **renomear**, o histórico também mantém o nome antigo. |
| RN10 — prioridade automática? | **Não.** Ordem de chegada é só informativa; a decisão é manual. |

Se o NTI decidir que **pendente bloqueia** (RN03), a mudança é: incluir `'PENDENTE'` no `WHERE` da constraint (nova migration) e na checagem de `POST /api/reservas`.

## 7. Estrutura

```
backend/
  migrations/001_init.sql     tabelas, enums, constraint de conflito, trigger de histórico
  src/config.ts               variáveis de ambiente + regras de negócio provisórias
  src/routes/                 auth, ambientes, reservas, notificacoes
  src/auth.ts                 sessão (cookie HttpOnly), papéis, permissão por ambiente
  src/seed.ts                 dados de exemplo
  test/                       testes de integração (Vitest)
frontend/
  src/pages/                  Login, Ambientes, AmbienteAgenda, MinhasReservas, Aprovacoes, Admin, Notificacoes
  src/styles.css              paleta UPE (vermelho #ED1C24, azul #2F4871)
  public/logo-upe.png         logo (fundo transparente)
docker-compose.yml            PostgreSQL 16
```

## 8. Fora do MVP / próximos passos

Reservas recorrentes, anexos, relatórios exportáveis, múltiplas autoridades por ambiente (a tabela já suporta), expiração automática e e-mail de notificação.

**Produção (quando chegar a hora):** defina `NODE_ENV=production`, um `JWT_SECRET` longo e aleatório, `DEV_LOGIN=false`, rode `npm --prefix frontend run build` e sirva `frontend/dist` atrás de HTTPS (RNF03) com proxy de `/api` para a API (Nginx, Caddy, etc.). O proxy do Vite só existe em desenvolvimento.

## Problemas comuns

- **`ECONNREFUSED` ao iniciar a API:** o PostgreSQL não está no ar. Rode `npm run db:up` (Docker Desktop precisa estar aberto).
- **Porta 5433 já em uso:** algum programa está usando essa porta. Troque `5433` por outro número (ex.: `5434`) no `docker-compose.yml` e no `DATABASE_URL` do `backend/.env`.
- **"autenticação do tipo senha falhou" no seed:** o projeto está falando com outro PostgreSQL. Confira se `DATABASE_URL` usa a porta **5433** (a do Docker), não a 5432.
- **Tela de login diz "back-end está rodando?":** a API (porta 3001) não subiu; veja o log no terminal.
- **Login Google dá "origin_mismatch":** a origem `http://localhost:5173` não está nas *Origens JavaScript autorizadas*.
