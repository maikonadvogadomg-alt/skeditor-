/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  SK Code Editor — Rotas de Banco de Dados                           ║
 * ║                                                                      ║
 * ║  Rotas disponíveis:                                                  ║
 * ║  POST /api/db/neon/create        → Cria projeto Neon                 ║
 * ║  GET  /api/db/neon/projects      → Lista projetos Neon               ║
 * ║  POST /api/db/neon/credentials   → Pega credenciais de projeto       ║
 * ║  POST /api/db/execute            → Executa SQL no banco              ║
 * ║  POST /api/db/test-connection    → Testa conexão com o banco         ║
 * ║                                                                      ║
 * ║  COMO OBTER A NEON API KEY:                                          ║
 * ║  1. Acesse https://console.neon.tech                                 ║
 * ║  2. Crie uma conta gratuita (sem cartão de crédito)                  ║
 * ║  3. Vá em Settings → API Keys → Create API Key                      ║
 * ║  4. A chave começa com "neon_api_..."                                ║
 * ║  5. Envie a chave para a Jasmim e ela criará o banco automaticamente ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const NEON_API_BASE = "https://console.neon.tech/api/v2";

// ─── Helper: chamada autenticada para API Neon ────────────────────────────────
async function neonRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: object,
): Promise<{ ok: boolean; status: number; data: any }> {
  const resp = await fetch(`${NEON_API_BASE}${path}`, {
    method,
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data: any;
  try { data = await resp.json(); } catch { data = {}; }

  return { ok: resp.ok, status: resp.status, data };
}

// ─── Helper: extrai connection string de um projeto Neon ─────────────────────
function extractConnectionInfo(project: any, connectionUri?: string) {
  const uri = connectionUri || "";
  let host = "", database = "", user = "", password = "";

  try {
    const url = new URL(uri);
    host     = url.hostname;
    database = url.pathname.slice(1);
    user     = url.username;
    password = url.password;
  } catch { /* uri inválida */ }

  return {
    projectId:        project?.id || "",
    projectName:      project?.name || "",
    connectionString: uri,
    host, database, user, password,
    port:             5432,
    region:           project?.region_id || "aws-us-east-2",
    createdAt:        project?.created_at || "",
  };
}

// ─── POST /api/db/neon/create ─────────────────────────────────────────────────
/**
 * Cria um novo projeto Neon (banco PostgreSQL gratuito).
 *
 * Body:
 *   neonApiKey  (string) — Chave da API Neon (começa com neon_api_...)
 *   projectName (string) — Nome do projeto/banco (ex: "meu-app")
 *   region      (string) — Região opcional (padrão: aws-us-east-2)
 *
 * Retorna:
 *   { projectId, projectName, connectionString, host, database, user, password, port }
 *
 * COMO OBTER A NEON API KEY:
 *   1. https://console.neon.tech → Settings → API Keys → Create API Key
 */
router.post("/db/neon/create", async (req, res) => {
  try {
    const { neonApiKey, projectName, region } = req.body as {
      neonApiKey: string;
      projectName: string;
      region?: string;
    };

    if (!neonApiKey?.trim()) {
      res.status(400).json({ message: "neonApiKey é obrigatório. Obtenha em: https://console.neon.tech → Settings → API Keys" });
      return;
    }
    if (!projectName?.trim()) {
      res.status(400).json({ message: "projectName é obrigatório." });
      return;
    }

    // 1. Cria o projeto
    const createResp = await neonRequest("POST", "/projects", neonApiKey, {
      project: {
        name: projectName.trim().toLowerCase().replace(/\s+/g, "-"),
        region_id: region || "aws-us-east-2",
        pg_version: 16,
      },
    });

    if (!createResp.ok) {
      const msg = createResp.data?.message || createResp.data?.error || `Erro Neon API: ${createResp.status}`;
      logger.error({ status: createResp.status, data: createResp.data }, "Erro ao criar projeto Neon");
      res.status(createResp.status).json({ message: msg });
      return;
    }

    const project  = createResp.data?.project;
    const connUri  = createResp.data?.connection_uris?.[0]?.connection_uri || "";
    const info     = extractConnectionInfo(project, connUri);

    logger.info({ projectId: info.projectId, projectName: info.projectName }, "Projeto Neon criado com sucesso");

    res.json({
      success: true,
      message: `Banco Neon "${info.projectName}" criado com sucesso!`,
      ...info,
      // Instruções de uso
      instrucoes: {
        instalar:   "npm install @neondatabase/serverless dotenv",
        envExample: `DATABASE_URL=${info.connectionString}`,
        codigoConexao: `const { neon } = require('@neondatabase/serverless');\nrequire('dotenv').config();\nconst sql = neon(process.env.DATABASE_URL);`,
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Erro /db/neon/create");
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/db/neon/projects ────────────────────────────────────────────────
/**
 * Lista todos os projetos Neon do usuário.
 *
 * Query params:
 *   neonApiKey (string) — Chave da API Neon
 *
 * Retorna: [{ projectId, projectName, region, createdAt }]
 */
router.get("/db/neon/projects", async (req, res) => {
  try {
    const { neonApiKey } = req.query as { neonApiKey: string };

    if (!neonApiKey?.trim()) {
      res.status(400).json({ message: "neonApiKey é obrigatório na query string." });
      return;
    }

    const resp = await neonRequest("GET", "/projects", neonApiKey);

    if (!resp.ok) {
      res.status(resp.status).json({ message: resp.data?.message || `Erro Neon API: ${resp.status}` });
      return;
    }

    const projects = (resp.data?.projects || []).map((p: any) => ({
      projectId:   p.id,
      projectName: p.name,
      region:      p.region_id,
      pgVersion:   p.pg_version,
      createdAt:   p.created_at,
      updatedAt:   p.updated_at,
    }));

    res.json({ projects, total: projects.length });
  } catch (err: any) {
    logger.error({ err }, "Erro /db/neon/projects");
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/db/neon/credentials ───────────────────────────────────────────
/**
 * Obtém as credenciais de conexão de um projeto Neon existente.
 *
 * Body:
 *   neonApiKey (string) — Chave da API Neon
 *   projectId  (string) — ID do projeto (obtido em /db/neon/projects)
 *
 * Retorna: { connectionString, host, database, user, password, port }
 */
router.post("/db/neon/credentials", async (req, res) => {
  try {
    const { neonApiKey, projectId } = req.body as {
      neonApiKey: string;
      projectId: string;
    };

    if (!neonApiKey?.trim() || !projectId?.trim()) {
      res.status(400).json({ message: "neonApiKey e projectId são obrigatórios." });
      return;
    }

    // Pega os branches do projeto (branch principal = main)
    const branchResp = await neonRequest("GET", `/projects/${projectId}/branches`, neonApiKey);
    if (!branchResp.ok) {
      res.status(branchResp.status).json({ message: branchResp.data?.message || "Erro ao obter branches." });
      return;
    }
    const mainBranch = branchResp.data?.branches?.find((b: any) => b.primary) || branchResp.data?.branches?.[0];

    // Pega os endpoints (connection info)
    const endpResp = await neonRequest("GET", `/projects/${projectId}/endpoints`, neonApiKey);
    if (!endpResp.ok) {
      res.status(endpResp.status).json({ message: endpResp.data?.message || "Erro ao obter endpoints." });
      return;
    }
    const endpoint = endpResp.data?.endpoints?.[0];

    // Pega as databases
    const dbResp = await neonRequest("GET", `/projects/${projectId}/branches/${mainBranch?.id}/databases`, neonApiKey);
    const database = dbResp.data?.databases?.[0]?.name || "neondb";

    // Pega os roles (usuários)
    const roleResp = await neonRequest("GET", `/projects/${projectId}/branches/${mainBranch?.id}/roles`, neonApiKey);
    const role = roleResp.data?.roles?.find((r: any) => !r.protected) || roleResp.data?.roles?.[0];

    if (!endpoint || !role) {
      res.status(404).json({ message: "Endpoint ou role não encontrado. O projeto pode estar sendo criado." });
      return;
    }

    // Obtém a senha do role
    const pwdResp = await neonRequest("GET", `/projects/${projectId}/branches/${mainBranch?.id}/roles/${role.name}/reveal_password`, neonApiKey);
    const password = pwdResp.data?.password || "";

    const host = endpoint?.host || "";
    const user = role?.name || "neondb_owner";
    const connectionString = `postgresql://${user}:${password}@${host}/${database}?sslmode=require`;

    res.json({
      success: true,
      projectId,
      connectionString,
      host,
      database,
      user,
      password,
      port:     5432,
      sslMode:  "require",
      instrucoes: {
        envExample:    `DATABASE_URL=${connectionString}`,
        instalar:      "npm install @neondatabase/serverless dotenv",
        testar:        "curl -X POST /api/db/test-connection -H 'Content-Type: application/json' -d '{\"connectionString\":\"...\"}' ",
      },
    });
  } catch (err: any) {
    logger.error({ err }, "Erro /db/neon/credentials");
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/db/execute ─────────────────────────────────────────────────────
/**
 * Executa SQL diretamente no banco de dados.
 *
 * Body:
 *   connectionString (string) — URL de conexão PostgreSQL
 *   sql              (string) — SQL a executar
 *
 * Retorna: { rows, rowCount } para SELECT, ou { success, rowCount } para outros
 *
 * ATENÇÃO: Não commite DDL destrutivo (DROP, TRUNCATE) sem confirmação do usuário.
 */
router.post("/db/execute", async (req, res) => {
  try {
    const { connectionString, sql } = req.body as { connectionString: string; sql: string };

    if (!connectionString?.trim()) {
      res.status(400).json({ message: "connectionString é obrigatório." });
      return;
    }
    if (!sql?.trim()) {
      res.status(400).json({ message: "sql é obrigatório." });
      return;
    }

    // Usa @neondatabase/serverless se disponível, senão usa pg
    let result: any;
    try {
      // Tenta com @neondatabase/serverless (mais leve, funciona com Neon)
      const { neon } = await import("@neondatabase/serverless" as any);
      const sqlFn = neon(connectionString);
      const rows = await sqlFn(sql);
      result = { rows: Array.isArray(rows) ? rows : [], rowCount: Array.isArray(rows) ? rows.length : 0 };
    } catch {
      // Fallback para pg
      const { Pool } = await import("pg" as any);
      const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false } });
      const queryResult = await pool.query(sql);
      await pool.end();
      result = { rows: queryResult.rows, rowCount: queryResult.rowCount };
    }

    res.json({ success: true, ...result });
  } catch (err: any) {
    logger.error({ err }, "Erro /db/execute");
    res.status(500).json({ message: err.message, success: false });
  }
});

// ─── POST /api/db/test-connection ────────────────────────────────────────────
/**
 * Testa se uma connection string está funcionando.
 *
 * Body:
 *   connectionString (string) — URL de conexão PostgreSQL
 *
 * Retorna: { ok, latencyMs, version } ou { ok: false, error }
 */
router.post("/db/test-connection", async (req, res) => {
  try {
    const { connectionString } = req.body as { connectionString: string };

    if (!connectionString?.trim()) {
      res.status(400).json({ message: "connectionString é obrigatório." });
      return;
    }

    const start = Date.now();
    try {
      let version = "PostgreSQL";
      try {
        const { neon } = await import("@neondatabase/serverless" as any);
        const sql = neon(connectionString);
        const rows = await sql`SELECT version()`;
        version = (rows[0]?.version || "PostgreSQL").split(" ").slice(0, 2).join(" ");
      } catch {
        const { Pool } = await import("pg" as any);
        const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
        const r = await pool.query("SELECT version()");
        await pool.end();
        version = (r.rows[0]?.version || "PostgreSQL").split(" ").slice(0, 2).join(" ");
      }

      res.json({ ok: true, latencyMs: Date.now() - start, version, message: `Conexão bem-sucedida! ${version}` });
    } catch (connErr: any) {
      res.json({ ok: false, latencyMs: Date.now() - start, error: connErr.message });
    }
  } catch (err: any) {
    logger.error({ err }, "Erro /db/test-connection");
    res.status(500).json({ message: err.message });
  }
});

export default router;
