import { Router, type Request } from "express";

const router = Router();

router.get("/config", (req: Request, res) => {
  const devDomain = process.env["REPLIT_DEV_DOMAIN"];
  const apiPort   = process.env["PORT"] ?? "8080";

  let terminalWsUrl: string | null = null;

  if (devDomain) {
    // Ambiente de desenvolvimento Replit: conecta direto na porta 8080
    // para evitar o duplo-proxy Replit→Vite→API que quebra WebSocket.
    terminalWsUrl = `wss://${devDomain}:${apiPort}/api/ws/terminal`;
  } else {
    // Produção: usa o host da própria requisição (mesmo domínio, path /api/ws/terminal).
    // O roteador Replit encaminha /api/* para este servidor.
    const host = req.headers.host ?? req.hostname;
    const proto = req.headers["x-forwarded-proto"] === "https" || req.secure ? "wss" : "ws";
    terminalWsUrl = `${proto}://${host}/api/ws/terminal`;
  }

  res.json({ terminalWsUrl, apiPort, devDomain: devDomain ?? null });
});

export default router;
