import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

// Busca web via DuckDuckGo Instant Answer API (sem chave)
router.get("/search", async (req, res) => {
  const q = String(req.query["q"] || "").trim();
  if (!q) { res.status(400).json({ error: "Parâmetro q obrigatório" }); return; }

  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`;
    const resp = await fetch(url, {
      headers: { "User-Agent": "SK-Code-Editor/1.0" },
      signal: AbortSignal.timeout(8000),
    });
    const data = await resp.json() as any;

    const results: { title: string; url: string; snippet: string }[] = [];

    if (data.AbstractText) {
      results.push({ title: data.Heading || q, url: data.AbstractURL || "", snippet: data.AbstractText });
    }

    for (const t of (data.RelatedTopics || [])) {
      if (results.length >= 8) break;
      if (t.Text && t.FirstURL) {
        results.push({ title: t.Text.split(" - ")[0] || t.Text, url: t.FirstURL, snippet: t.Text });
      }
    }

    res.json({ query: q, results });
  } catch (err: any) {
    logger.error({ err }, "Erro na busca");
    res.status(503).json({ error: "Serviço de busca temporariamente indisponível", details: err.message });
  }
});

// Busca npm: registry API oficial, sem autenticação
router.get("/npm-search", async (req, res) => {
  const q = String(req.query["q"] || "").trim();
  if (!q) { res.status(400).json({ error: "Parâmetro q obrigatório" }); return; }
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}&size=15`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const data = await resp.json() as any;
    const results = (data.objects || []).map((o: any) => ({
      name: o.package?.name,
      description: o.package?.description,
      version: o.package?.version,
      links: o.package?.links,
      score: o.score?.final,
      downloads: o.downloads?.monthly,
    }));
    res.json({ query: q, results });
  } catch (err: any) {
    logger.error({ err }, "Erro npm search");
    res.status(503).json({ error: "Erro ao buscar no npm", details: err.message });
  }
});

export default router;
