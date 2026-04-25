/**
 * POST /api/ai/forward
 *
 * Proxy seguro para chamadas de IA com a chave do próprio usuário.
 * Resolve problemas de CORS — o navegador não pode chamar provedores externos
 * diretamente, então essa rota faz a chamada pelo servidor.
 *
 * Body:
 *   apiKey    (string) — Chave do usuário (gsk_, sk-, AIza, xai-, pplx-, sk-ant, sk-or-)
 *   apiUrl    (string) — URL base do provedor (ex: https://api.groq.com/openai/v1)
 *   model     (string) — Modelo a usar (ex: llama-3.3-70b-versatile)
 *   messages  (array)  — [{ role, content }]
 *   stream    (bool)   — Se true, responde como SSE (event-stream)
 *   maxTokens (number) — Máximo de tokens (padrão: 16384)
 *   systemPrompt (string) — System prompt adicional (opcional)
 */

import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const ALLOWED_HOSTS = [
  "api.groq.com",
  "api.openai.com",
  "api.x.ai",
  "api.anthropic.com",
  "api.perplexity.ai",
  "openrouter.ai",
  "generativelanguage.googleapis.com",
  "api.mistral.ai",
  "api.together.xyz",
  "api.deepseek.com",
  "api.cohere.com",
];

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.some(
      h => parsed.hostname === h || parsed.hostname.endsWith("." + h),
    );
  } catch {
    return false;
  }
}

// ─── POST /api/ai/forward ─────────────────────────────────────────────────────
router.post("/ai/forward", async (req, res) => {
  try {
    const {
      apiKey,
      apiUrl,
      model,
      messages,
      stream = true,
      maxTokens = 16384,
      systemPrompt,
    } = req.body as {
      apiKey: string;
      apiUrl: string;
      model: string;
      messages: { role: string; content: string }[];
      stream?: boolean;
      maxTokens?: number;
      systemPrompt?: string;
    };

    if (!apiKey?.trim()) {
      res.status(400).json({ error: "apiKey é obrigatório." });
      return;
    }
    if (!apiUrl?.trim()) {
      res.status(400).json({ error: "apiUrl é obrigatório." });
      return;
    }
    if (!isAllowedUrl(apiUrl)) {
      res.status(403).json({ error: `Provedor não permitido: ${apiUrl}. Use um dos provedores suportados (Groq, OpenAI, Gemini, etc.)` });
      return;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages é obrigatório e deve ser um array." });
      return;
    }

    const cleanUrl = apiUrl.trim().replace(/\/$/, "");
    const endpoint = `${cleanUrl}/chat/completions`;

    const finalMessages = systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages;

    // Headers para o provedor — OpenRouter requer Referer e X-Title
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey.trim()}`,
      "HTTP-Referer": "https://sk-code-editor.replit.app",
      "X-Title": "SK Code Editor",
      "User-Agent": "SK-Code-Editor/1.0",
    };

    const body = JSON.stringify({
      model,
      messages: finalMessages,
      stream,
      max_tokens: maxTokens,
    });

    const upstreamResp = await fetch(endpoint, {
      method: "POST",
      headers,
      body,
    });

    if (!upstreamResp.ok) {
      const errText = await upstreamResp.text().catch(() => `Erro ${upstreamResp.status}`);
      logger.warn({ status: upstreamResp.status, url: cleanUrl }, "Provedor retornou erro");
      res.status(upstreamResp.status).json({ error: errText.substring(0, 500) });
      return;
    }

    if (stream && upstreamResp.body) {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("X-Accel-Buffering", "no");
      res.setHeader("Connection", "keep-alive");

      const reader = upstreamResp.body.getReader();
      const decoder = new TextDecoder();

      req.on("close", () => { reader.cancel(); });

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } finally {
        res.end();
      }
    } else {
      const data = await upstreamResp.json();
      res.json(data);
    }
  } catch (err: any) {
    logger.error({ err }, "Erro /ai/forward");
    if (!res.headersSent) {
      res.status(500).json({ error: err.message || "Erro interno." });
    }
  }
});

export default router;
