import { Router } from "express";
import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

const router = Router();

// ─── GET|POST /api/proxy/:port/* ──────────────────────────────────────────────
// Faz proxy para localhost:port — usado pelo Preview para mostrar apps Node.js
// que o usuário iniciou no terminal.
// Segurança: só aceita portas ≥ 1024 e < 65535 para evitar acesso a serviços do sistema.
router.all(/^\/proxy\/(\d+)(\/.*)?$/, (req, res: ServerResponse) => {
  const portStr = req.params[0];
  const subpath = req.params[1] || "/";

  const port = Number(portStr);
  if (!port || port < 1024 || port > 65534) {
    (res as any).status(400).json({ error: "Porta inválida." });
    return;
  }

  const options: http.RequestOptions = {
    hostname: "127.0.0.1",
    port,
    path: subpath + (req.url.includes("?") ? "?" + req.url.split("?")[1] : ""),
    method: req.method,
    headers: {
      ...req.headers,
      host: `localhost:${port}`,
    },
    timeout: 10000,
  };

  const proxyReq = http.request(options, (proxyRes: IncomingMessage) => {
    res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on("error", (err: Error) => {
    if (!res.headersSent) {
      (res as any).status(502).json({
        error: `Servidor na porta ${port} não respondeu.`,
        detail: err.message,
      });
    }
  });

  proxyReq.on("timeout", () => {
    proxyReq.destroy();
    if (!res.headersSent) {
      (res as any).status(504).json({ error: `Timeout ao conectar à porta ${port}.` });
    }
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq, { end: true });
  } else {
    proxyReq.end();
  }
});

export default router;
