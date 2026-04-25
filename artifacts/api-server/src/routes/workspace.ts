import { Router } from "express";
import {
  existsSync, mkdirSync, writeFileSync, readFileSync,
  readdirSync, statSync, rmSync,
} from "node:fs";
import { join, dirname, relative, basename } from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "../lib/logger";

const execAsync = promisify(exec);
const router = Router();

// Diretório raiz do workspace do usuário — persiste durante a sessão
export const WORKSPACE_DIR =
  process.env["SK_WORKSPACE_DIR"] ||
  join(process.env["HOME"] || "/home/runner", "sk-user-workspace");

// Garante que o diretório existe
function ensureWorkspace(): void {
  if (!existsSync(WORKSPACE_DIR)) {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
    // package.json padrão
    const pkg = {
      name: "sk-projeto",
      version: "1.0.0",
      description: "Projeto SK Code Editor",
      main: "index.js",
      scripts: { start: "node index.js", dev: "node index.js" },
      dependencies: {},
    };
    writeFileSync(join(WORKSPACE_DIR, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
  }
}

// ─── GET /api/workspace/info ──────────────────────────────────────────────────
router.get("/workspace/info", (_req, res) => {
  ensureWorkspace();
  res.json({ workspaceDir: WORKSPACE_DIR, exists: existsSync(WORKSPACE_DIR) });
});

// ─── POST /api/workspace/write ────────────────────────────────────────────────
// Escreve um arquivo no workspace do servidor
// Body: { path: string (relativo), content: string }
router.post("/workspace/write", (req, res) => {
  try {
    ensureWorkspace();
    const { path: filePath, content } = req.body as { path: string; content: string };
    if (!filePath) { res.status(400).json({ message: "Campo 'path' obrigatório." }); return; }

    // Segurança: impede path traversal
    const safe = relative(WORKSPACE_DIR, join(WORKSPACE_DIR, filePath));
    if (safe.startsWith("..")) { res.status(400).json({ message: "Caminho inválido." }); return; }

    const abs = join(WORKSPACE_DIR, safe);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content ?? "", "utf8");
    res.json({ ok: true, path: safe });
  } catch (err: any) {
    logger.error({ err }, "Erro /workspace/write");
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/workspace/read ──────────────────────────────────────────────────
// Lê um arquivo do workspace
router.get("/workspace/read", (req, res) => {
  try {
    ensureWorkspace();
    const filePath = String(req.query["path"] || "");
    if (!filePath) { res.status(400).json({ message: "Query 'path' obrigatória." }); return; }

    const safe = relative(WORKSPACE_DIR, join(WORKSPACE_DIR, filePath));
    if (safe.startsWith("..")) { res.status(400).json({ message: "Caminho inválido." }); return; }

    const abs = join(WORKSPACE_DIR, safe);
    if (!existsSync(abs)) { res.status(404).json({ message: "Arquivo não encontrado." }); return; }

    const content = readFileSync(abs, "utf8");
    res.json({ content, path: safe });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── GET /api/workspace/list ──────────────────────────────────────────────────
// Lista arquivos no workspace (recursivo, profundidade limitada)
router.get("/workspace/list", (req, res) => {
  try {
    ensureWorkspace();
    const result: Array<{ path: string; size: number; isDir: boolean }> = [];
    const IGNORE = new Set(["node_modules", ".git", ".cache", "dist", ".next", "__pycache__"]);

    function walk(dir: string, depth = 0) {
      if (depth > 5) return;
      const entries = readdirSync(dir);
      for (const name of entries) {
        if (IGNORE.has(name)) continue;
        const abs = join(dir, name);
        const rel = relative(WORKSPACE_DIR, abs);
        try {
          const st = statSync(abs);
          result.push({ path: rel, size: st.size, isDir: st.isDirectory() });
          if (st.isDirectory()) walk(abs, depth + 1);
        } catch { /* ignora */ }
      }
    }
    walk(WORKSPACE_DIR);
    res.json({ files: result, workspaceDir: WORKSPACE_DIR });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/workspace/delete ───────────────────────────────────────────────
// Remove um arquivo do workspace
router.post("/workspace/delete", (req, res) => {
  try {
    const { path: filePath } = req.body as { path: string };
    if (!filePath) { res.status(400).json({ message: "Campo 'path' obrigatório." }); return; }

    const safe = relative(WORKSPACE_DIR, join(WORKSPACE_DIR, filePath));
    if (safe.startsWith("..")) { res.status(400).json({ message: "Caminho inválido." }); return; }

    const abs = join(WORKSPACE_DIR, safe);
    if (existsSync(abs)) rmSync(abs, { recursive: true, force: true });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ message: err.message });
  }
});

// ─── POST /api/workspace/install ─────────────────────────────────────────────
// Instala pacotes npm/pip no workspace — retorna saída em streaming
// Body: { packages?: string[], packageJson?: string, dev?: boolean, pip?: boolean }
router.post("/workspace/install", async (req, res) => {
  ensureWorkspace();
  const { packages, packageJson, dev, pip } = req.body as {
    packages?: string[];
    packageJson?: string;
    dev?: boolean;
    pip?: boolean;
  };

  // Atualiza package.json se fornecido
  if (packageJson && !pip) {
    try {
      writeFileSync(join(WORKSPACE_DIR, "package.json"), packageJson, "utf8");
    } catch { /* ignora */ }
  }

  let cmd: string;

  if (pip) {
    // ── Instalação Python via pip3 ──────────────────────────────────────────
    const pkgList = packages && packages.length > 0
      ? packages.map(p => `"${p.replace(/"/g, "")}"`) .join(" ")
      : "";
    if (!pkgList) { res.status(400).json({ message: "Nenhum pacote especificado." }); return; }
    cmd = `pip3 install ${pkgList} --break-system-packages 2>&1 || pip install ${pkgList} 2>&1`;
  } else {
    // ── Instalação npm ──────────────────────────────────────────────────────
    // Encontra npm
    let npmBin = "npm";
    try {
      const { stdout } = await execAsync("which npm 2>/dev/null || which pnpm 2>/dev/null");
      npmBin = stdout.trim().split("\n")[0] || "npm";
    } catch { /* usa npm padrão */ }

    const pkgList = packages && packages.length > 0
      ? packages.map(p => `"${p.replace(/"/g, "")}"`) .join(" ")
      : "";

    const saveFlag = dev ? "--save-dev" : "--save";
    cmd = pkgList
      ? `${npmBin} install ${pkgList} ${saveFlag} 2>&1`
      : `${npmBin} install 2>&1`;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ out: `\x1b[36m$ ${cmd}\x1b[0m\n` })}\n\n`);

  const child = exec(cmd, {
    cwd: WORKSPACE_DIR,
    timeout: 180_000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, npm_config_loglevel: "warn" },
  });

  child.stdout?.on("data", (d: string) => res.write(`data: ${JSON.stringify({ out: d })}\n\n`));
  child.stderr?.on("data", (d: string) => res.write(`data: ${JSON.stringify({ out: d })}\n\n`));

  child.on("close", (code) => {
    const ok = code === 0;
    let updatedPkg: string | null = null;
    try { updatedPkg = readFileSync(join(WORKSPACE_DIR, "package.json"), "utf8"); } catch { /* ok */ }
    res.write(`data: ${JSON.stringify({ done: true, ok, code, updatedPackageJson: updatedPkg })}\n\n`);
    res.end();
  });

  child.on("error", (err) => {
    res.write(`data: ${JSON.stringify({ out: `\n\x1b[31mErro: ${err.message}\x1b[0m\n`, done: true, ok: false })}\n\n`);
    res.end();
  });
});

// ─── POST /api/workspace/run ──────────────────────────────────────────────────
// Salva arquivos e executa o código — streaming de saída
// Body: { files: [{path, content}], entrypoint: string, runtime?: "node"|"python"|"bash" }
router.post("/workspace/run", async (req, res) => {
  ensureWorkspace();
  const {
    files, entrypoint, runtime,
  } = req.body as {
    files: Array<{ path: string; content: string }>;
    entrypoint: string;
    runtime?: string;
  };

  if (!entrypoint) { res.status(400).json({ message: "entrypoint obrigatório." }); return; }

  // Salva todos os arquivos fornecidos
  if (Array.isArray(files)) {
    for (const f of files) {
      try {
        const safe = relative(WORKSPACE_DIR, join(WORKSPACE_DIR, f.path));
        if (!safe.startsWith("..")) {
          const abs = join(WORKSPACE_DIR, safe);
          mkdirSync(dirname(abs), { recursive: true });
          writeFileSync(abs, f.content || "", "utf8");
        }
      } catch { /* ignora */ }
    }
  }

  // Detecta o runtime correto
  const ext = entrypoint.split(".").pop()?.toLowerCase() || "";
  let cmd: string;
  if (runtime === "python" || ext === "py") {
    cmd = `python3 "${basename(entrypoint)}" 2>&1`;
  } else if (runtime === "bash" || ext === "sh") {
    cmd = `bash "${basename(entrypoint)}" 2>&1`;
  } else if (runtime === "node" || ["js", "mjs", "cjs", "ts"].includes(ext)) {
    if (ext === "ts") {
      // TypeScript: usa ts-node se disponível, senão compila
      const tsNode = existsSync(join(WORKSPACE_DIR, "node_modules/.bin/ts-node"));
      cmd = tsNode
        ? `./node_modules/.bin/ts-node "${basename(entrypoint)}" 2>&1`
        : `node --experimental-strip-types "${basename(entrypoint)}" 2>&1`;
    } else {
      cmd = `node "${basename(entrypoint)}" 2>&1`;
    }
  } else {
    cmd = `node "${basename(entrypoint)}" 2>&1`;
  }

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.write(`data: ${JSON.stringify({ out: `\x1b[36m$ ${cmd}\x1b[0m\n` })}\n\n`);

  const child = exec(cmd, {
    cwd: WORKSPACE_DIR,
    timeout: 60_000,
    maxBuffer: 5 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: join(WORKSPACE_DIR, "node_modules") },
  });

  child.stdout?.on("data", (d: string) => res.write(`data: ${JSON.stringify({ out: d })}\n\n`));
  child.stderr?.on("data", (d: string) => res.write(`data: ${JSON.stringify({ out: d })}\n\n`));

  child.on("close", (code) => {
    res.write(`data: ${JSON.stringify({ done: true, code })}\n\n`);
    res.end();
  });

  child.on("error", (err) => {
    res.write(`data: ${JSON.stringify({ out: `\n\x1b[31mErro: ${err.message}\x1b[0m\n`, done: true, code: 1 })}\n\n`);
    res.end();
  });

  req.on("close", () => { try { child.kill("SIGTERM"); } catch { } });
});

// ─── POST /api/workspace/sync ─────────────────────────────────────────────────
// Sincroniza múltiplos arquivos do editor → servidor
// Body: { files: [{path, content}] }
router.post("/workspace/sync", (req, res) => {
  try {
    ensureWorkspace();
    const { files } = req.body as { files: Array<{ path: string; content: string }> };
    if (!Array.isArray(files)) { res.status(400).json({ message: "Campo 'files' deve ser array." }); return; }

    const written: string[] = [];
    for (const f of files) {
      if (!f.path) continue;
      try {
        const safe = relative(WORKSPACE_DIR, join(WORKSPACE_DIR, f.path));
        if (safe.startsWith("..")) continue;
        const abs = join(WORKSPACE_DIR, safe);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, f.content || "", "utf8");
        written.push(safe);
      } catch { /* ignora arquivo com erro */ }
    }
    res.json({ ok: true, written, workspaceDir: WORKSPACE_DIR });
  } catch (err: any) {
    logger.error({ err }, "Erro /workspace/sync");
    res.status(500).json({ message: err.message });
  }
});

export default router;
