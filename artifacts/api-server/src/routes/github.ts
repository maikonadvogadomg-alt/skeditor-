import { Router } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";

const router = Router();
const connectors = new ReplitConnectors();

// GET /api/github/user — dados do usuário autenticado
router.get("/github/user", async (_req, res) => {
  try {
    const resp = await connectors.proxy("github", "/user", { method: "GET" });
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/github/repos — lista repos do usuário
router.get("/github/repos", async (_req, res) => {
  try {
    const resp = await connectors.proxy("github", "/user/repos?per_page=100&sort=updated", { method: "GET" });
    const data = await resp.json();
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/repos — cria novo repositório
// body: { name, description?, private? }
router.post("/github/repos", async (req, res) => {
  const { name, description = "", isPrivate = false } = req.body;
  if (!name) { res.status(400).json({ error: "name é obrigatório" }); return; }
  try {
    const resp = await connectors.proxy("github", "/user/repos", {
      method: "POST",
      body: JSON.stringify({ name, description, private: isPrivate, auto_init: true }),
    });
    const data = await resp.json() as any;
    res.status(resp.status).json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/github/push — faz push de arquivos (cria/atualiza múltiplos arquivos via API)
// body: { owner, repo, branch?, files: [{path, content}], message? }
router.post("/github/push", async (req, res) => {
  const { owner, repo, branch = "main", files, message = "Commit via SK Code Editor" } = req.body;
  if (!owner || !repo || !files?.length) {
    res.status(400).json({ error: "owner, repo e files são obrigatórios" }); return;
  }
  try {
    const results: { path: string; status: string; sha?: string; error?: string }[] = [];

    for (const file of files as { path: string; content: string }[]) {
      // Verifica se já existe (pega sha)
      let sha: string | undefined;
      try {
        const existing = await connectors.proxy("github", `/repos/${owner}/${repo}/contents/${file.path}?ref=${branch}`, { method: "GET" });
        if (existing.status === 200) {
          const existingData = await existing.json() as any;
          sha = existingData.sha;
        }
      } catch { /* arquivo não existe ainda — ok */ }

      const content = Buffer.from(file.content, "utf-8").toString("base64");
      const body: Record<string, any> = { message, content, branch };
      if (sha) body.sha = sha;

      const putResp = await connectors.proxy("github", `/repos/${owner}/${repo}/contents/${file.path}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      const putData = await putResp.json() as any;

      if (putResp.status === 200 || putResp.status === 201) {
        results.push({ path: file.path, status: "ok", sha: putData.content?.sha });
      } else {
        results.push({ path: file.path, status: "error", error: putData.message || "Erro desconhecido" });
      }
    }

    res.json({ results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/github/repos/:owner/:repo — deleta repositório
router.delete("/github/repos/:owner/:repo", async (req, res) => {
  const { owner, repo } = req.params;
  try {
    const resp = await connectors.proxy("github", `/repos/${owner}/${repo}`, { method: "DELETE" });
    if (resp.status === 204) {
      res.json({ ok: true });
    } else {
      const data = await resp.json();
      res.status(resp.status).json(data);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
