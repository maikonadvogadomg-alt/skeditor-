import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, chmodSync, unlinkSync, mkdirSync, writeFileSync } from "node:fs";
import { join as pathJoin } from "node:path";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import app from "./app";
import { logger } from "./lib/logger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rawPort = process.env["PORT"];
if (!rawPort) throw new Error("PORT environment variable is required.");
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT: "${rawPort}"`);

const server = http.createServer(app);

// ─── WebSocket Terminal ───────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = req.url ?? "";
  if (url === "/api/ws/terminal" || url === "/ws/terminal" || url.endsWith("/ws/terminal")) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
});

// ─── Detectar modo de terminal disponivel ────────────────────────────────────
// Hierarquia:
//   1. pty_helper (C custom) — melhor: cores, resize, scrollback completo
//   2. script -q /dev/null   — bom: cria PTY sem precisar de gcc (disponível em prod)
//   3. bash --login          — basico: sem PTY, sem cores, buffering limitado
const PTY_HELPER = path.resolve(__dirname, "../pty_helper");
const PTY_SRC    = path.resolve(__dirname, "../pty_helper.c");

type TermMode = "pty_helper" | "script" | "script-noflush" | "stdbuf" | "bash";

function detectTermMode(): TermMode {
  // Tentativa 1: compilar pty_helper.c fresh (se gcc disponivel)
  if (existsSync(PTY_SRC)) {
    try { if (existsSync(PTY_HELPER)) unlinkSync(PTY_HELPER); } catch { /* ok */ }
    for (const cc of ["gcc", "cc", "g++"]) {
      const r = spawnSync(cc, ["-O2", "-o", PTY_HELPER, PTY_SRC, "-lutil"], {
        stdio: "pipe", encoding: "utf8",
      });
      if (r.status === 0) {
        try { chmodSync(PTY_HELPER, 0o755); } catch { /* ok */ }
        logger.info({ compiler: cc }, "pty_helper compilado com sucesso");
        return "pty_helper";
      }
    }
  }

  // Tentativa 2: usar `script` (cria PTY sem gcc — disponivel em producao)
  const scriptCheck = spawnSync("which", ["script"], { stdio: "pipe", encoding: "utf8" });
  if (scriptCheck.status === 0 && scriptCheck.stdout.trim()) {
    // Verifica se a flag -f (flush) está disponível nessa versão do script
    const scriptFlushCheck = spawnSync("script", ["--help"], { stdio: "pipe", encoding: "utf8" });
    const helpText = (scriptFlushCheck.stdout || "") + (scriptFlushCheck.stderr || "");
    const hasFlush = helpText.includes("-f") || helpText.includes("--flush");
    logger.info({ hasFlush }, "Terminal PTY via script command");
    return hasFlush ? "script" : "script-noflush";
  }

  // Tentativa 3: stdbuf — força line-buffering sem precisar de PTY
  const stdbufCheck = spawnSync("which", ["stdbuf"], { stdio: "pipe", encoding: "utf8" });
  if (stdbufCheck.status === 0 && stdbufCheck.stdout.trim()) {
    logger.info("Terminal via stdbuf (line-buffered bash)");
    return "stdbuf" as TermMode;
  }

  // Fallback: bash direto sem PTY
  logger.warn("Terminal em modo basico (sem PTY) — sem cores e buffering limitado");
  return "bash";
}

const TERM_MODE = detectTermMode();
logger.info({ mode: TERM_MODE }, "Modo de terminal selecionado");

// ─── Configuracao do shell ────────────────────────────────────────────────────
// Workspace persistente do usuário — terminal começa aqui, npm install funciona aqui
const WORKSPACE_DIR = process.env["SK_WORKSPACE_DIR"] ||
  pathJoin(process.env["HOME"] || process.env["REPL_HOME"] || "/home/runner", "sk-user-workspace");

if (!existsSync(WORKSPACE_DIR)) {
  try {
    mkdirSync(WORKSPACE_DIR, { recursive: true });
    const defaultPkg = JSON.stringify({
      name: "sk-projeto", version: "1.0.0", main: "index.js",
      scripts: { start: "node index.js", dev: "node index.js" },
      dependencies: {},
    }, null, 2);
    writeFileSync(pathJoin(WORKSPACE_DIR, "package.json"), defaultPkg, "utf8");
    logger.info({ dir: WORKSPACE_DIR }, "Workspace do usuário criado");
  } catch (err) {
    logger.warn({ err }, "Não foi possível criar workspace — usando HOME como fallback");
  }
}

const cwd = existsSync(WORKSPACE_DIR) ? WORKSPACE_DIR :
  (process.env["HOME"] || process.env["REPL_HOME"] || "/home/runner");

// Detecta o Python3 instalado via Nix para passar ao node-gyp
const PYTHON3_PATH = (() => {
  try {
    const { execSync } = require("child_process");
    return execSync("which python3 2>/dev/null", { encoding: "utf8" }).trim() || "";
  } catch { return ""; }
})();

const shellEnv = {
  ...process.env,
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  FORCE_COLOR: "3",
  LANG: "pt_BR.UTF-8",
  SHELL: process.env["SHELL"] || "/bin/bash",
  // Força npm/pip a mostrar cada pacote sendo baixado em tempo real
  NPM_CONFIG_PROGRESS: "true",
  NPM_CONFIG_LOGLEVEL: "verbose",
  NPM_CONFIG_COLOR: "always",
  CI: "false",
  PYTHONUNBUFFERED: "1",
  NODE_NO_READLINE: "0",
  // node-gyp precisa de PYTHON para compilar módulos nativos (ex: drivelist, canvas, bcrypt)
  ...(PYTHON3_PATH ? {
    PYTHON: PYTHON3_PATH,
    npm_config_python: PYTHON3_PATH,
  } : {}),
};

// ─── WebSocket: uma sessao de terminal por conexao ───────────────────────────
wss.on("connection", (ws: WebSocket) => {
  let cols = 220;
  let rows = 50;

  // ── Keepalive duplo: ping/pong WebSocket + dados reais ────────────────────
  // O proxy do Replit fecha conexões WebSocket por INATIVIDADE DE DADOS (não por
  // ausência de ping). Precisamos enviar dados reais a cada ~30s para manter vivo.
  // Usamos uma sequência ANSI invisível: salva cursor e restaura imediatamente.
  // O xterm.js no cliente simplesmente ignora (sem efeito visível).
  let isAlive = true;
  ws.on("pong", () => { isAlive = true; });
  const keepAlive = setInterval(() => {
    if (!isAlive) { clearInterval(keepAlive); ws.terminate(); return; }
    isAlive = false;
    try { ws.ping(); } catch { clearInterval(keepAlive); }
  }, 20_000);

  // Heartbeat de DADOS a cada 25s — mantém o proxy HTTP do Replit vivo
  // \x1b[s = salva posição do cursor  \x1b[u = restaura posição do cursor
  // Efeito visível: zero. Previne timeout do proxy durante npm install longas.
  const dataHeartbeat = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(Buffer.from("\x1b[s\x1b[u")); } catch { /* ok */ }
    }
  }, 25_000);

  ws.on("close", () => { clearInterval(keepAlive); clearInterval(dataHeartbeat); });
  ws.on("error", () => { clearInterval(keepAlive); clearInterval(dataHeartbeat); });

  // Monta o comando/args correto conforme o modo disponivel
  let shellCmd: string;
  let shellArgs: string[];

  if (TERM_MODE === "pty_helper") {
    shellCmd = PTY_HELPER;
    shellArgs = [String(rows), String(cols)];
  } else if (TERM_MODE === "script") {
    // `script -q -f /dev/null` cria um PTY com flush imediato (output ao vivo)
    const scriptBin = spawnSync("which", ["script"], { stdio: "pipe", encoding: "utf8" }).stdout.trim() || "/usr/bin/script";
    shellCmd = scriptBin;
    shellArgs = ["-q", "-f", "/dev/null", "--", "/bin/bash", "--login"];
  } else if (TERM_MODE === "script-noflush") {
    // script disponível mas sem -f: usa sem flush (output pode ter leve delay)
    const scriptBin = spawnSync("which", ["script"], { stdio: "pipe", encoding: "utf8" }).stdout.trim() || "/usr/bin/script";
    shellCmd = scriptBin;
    shellArgs = ["-q", "/dev/null", "--", "/bin/bash", "--login"];
  } else if (TERM_MODE === "stdbuf") {
    // stdbuf -oL -eL força line-buffering sem PTY — saída linha a linha
    const stdbufBin = spawnSync("which", ["stdbuf"], { stdio: "pipe", encoding: "utf8" }).stdout.trim() || "/usr/bin/stdbuf";
    shellCmd = stdbufBin;
    shellArgs = ["-oL", "-eL", "/bin/bash", "--login"];
  } else {
    shellCmd = "/bin/bash";
    shellArgs = ["--login"];
  }

  const shell = spawn(shellCmd, shellArgs, {
    cwd,
    env: shellEnv,
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Mensagem de boas-vindas + configura npm para mostrar saída ao vivo
  setTimeout(() => {
    if (shell.stdin && !shell.killed) {
      shell.stdin.write(
        `echo -e "\\x1b[90m\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\r\\n\u{1F4C1} Workspace: ${cwd}\\r\\n\u{1F4A1} 'node arquivo.js' ou 'python3 arquivo.py' \u2014 use Sync\u2191 no editor primeiro!\\r\\n\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\\x1b[0m"\r\n` +
        // Configura ~/.npmrc global: resolve 90% dos erros de instalação de pacotes
        // legacy-peer-deps: ignora conflitos de versão (ERESOLVE)
        // python: aponta o node-gyp para o Python3 (compila módulos nativos)
        // fund/audit: desativa avisos desnecessários
        (PYTHON3_PATH
          ? `printf 'legacy-peer-deps=true\\nprogress=true\\nfund=false\\naudit=false\\n${PYTHON3_PATH ? "python=" + PYTHON3_PATH + "\\n" : ""}' > ~/.npmrc`
          : `printf 'legacy-peer-deps=true\\nprogress=true\\nfund=false\\naudit=false\\n' > ~/.npmrc`) +
        ` && export PYTHON="${PYTHON3_PATH}" && export npm_config_python="${PYTHON3_PATH}"` +
        ` && echo -e "\\x1b[32m✔ npm configurado\\x1b[90m (legacy-peer-deps=true | python: ${PYTHON3_PATH ? "ok" : "não encontrado"})\\x1b[0m"` +
        `\r\n`
      );
    }
  }, 600);

  shell.on("error", (err) => {
    logger.error({ err, mode: TERM_MODE }, "Erro ao iniciar shell");
    // Se script falhou, tenta bash direto como ultimo recurso
    if (TERM_MODE === "script") {
      const fallback = spawn("/bin/bash", ["--login"], { cwd, env: shellEnv, stdio: ["pipe", "pipe", "pipe"] });
      const sendFb = (d: Buffer | string) => { if (ws.readyState === WebSocket.OPEN) ws.send(d instanceof Buffer ? d : Buffer.from(d)); };
      fallback.stdout?.on("data", (c: Buffer) => sendFb(c));
      fallback.stderr?.on("data", (c: Buffer) => sendFb(c));
      fallback.on("exit", (code) => { sendFb(`\r\n\x1b[90m[encerrado: ${code ?? 0}]\x1b[0m\r\n`); try { ws.close(); } catch { } });
      ws.on("message", (d: Buffer | string) => { try { fallback.stdin?.write(typeof d === "string" ? d : d); } catch { } });
      ws.on("close", () => { try { fallback.kill("SIGTERM"); } catch { } });
    } else {
      const msg = `\r\n\x1b[31m[Erro ao iniciar terminal: ${err.message}]\x1b[0m\r\n`;
      if (ws.readyState === WebSocket.OPEN) ws.send(Buffer.from(msg));
      ws.close();
    }
  });

  const send = (data: Buffer | string) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data instanceof Buffer ? data : Buffer.from(data));
    }
  };

  shell.stdout?.on("data", (chunk: Buffer) => send(chunk));
  shell.stderr?.on("data", (chunk: Buffer) => send(chunk));

  shell.on("exit", (code: number | null) => {
    send(`\r\n\x1b[90m[processo encerrado com codigo ${code ?? 0}]\x1b[0m\r\n`);
    try { ws.close(); } catch { }
  });

  ws.on("message", (data: Buffer | string) => {
    try {
      const msg = typeof data === "string" ? data : data.toString();

      // Resize: {"type":"resize","cols":N,"rows":N}
      if (msg.startsWith("{") && msg.includes('"type":"resize"')) {
        try {
          const obj = JSON.parse(msg);
          if (obj.type === "resize" && obj.cols && obj.rows) {
            cols = Number(obj.cols);
            rows = Number(obj.rows);
            if (TERM_MODE === "pty_helper") {
              const resizeCmd = Buffer.concat([
                Buffer.from([0x00]),
                Buffer.from(`RESIZE:${rows}:${cols}\n`),
              ]);
              shell.stdin?.write(resizeCmd);
            }
          }
        } catch { /* ignore malformed resize */ }
        return;
      }

      shell.stdin?.write(typeof data === "string" ? data : data);
    } catch (err) {
      logger.warn({ err }, "Erro ao escrever no shell");
    }
  });

  ws.on("close", () => { try { shell.kill("SIGTERM"); } catch { } });
  ws.on("error", () => { try { shell.kill("SIGTERM"); } catch { } });
});

// ─── HTTP Listen ──────────────────────────────────────────────────────────────
server.listen(port, (err?: Error) => {
  if (err) { logger.error({ err }, "Error listening"); process.exit(1); }
  logger.info({ port, mode: TERM_MODE }, "Server listening");
});
