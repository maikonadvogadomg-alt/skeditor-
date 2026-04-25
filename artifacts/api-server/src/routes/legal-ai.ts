import { Router } from "express";
import OpenAI from "openai";
import { logger } from "../lib/logger";

const router = Router();

const SYSTEM_PROMPT = `Voce e uma assistente juridica especializada em Direito brasileiro. Produza documentos COMPLETOS, EXTENSOS e PRONTOS PARA USO IMEDIATO.

REGRAS ABSOLUTAS:
1. DOCUMENTO COMPLETO E EXTENSO — nunca resuma, nunca corte, nunca omita. Escreva o documento inteiro do inicio ao fim. O advogado copia e cola direto no Word.
2. ESTRUTURA OBRIGATORIA para peticoes e minutas: Endereçamento → Qualificação das partes → Dos Fatos (detalhado) → Do Direito (com fundamentacao legal) → Dos Pedidos → Local, data e assinatura.
3. FUNDAMENTACAO ROBUSTA — cite artigos de lei, numeros de lei, doutrina, principios. Desenvolva cada argumento em paragrafos proprios.
4. Base-se EXCLUSIVAMENTE no texto fornecido. Nao invente fatos. Se faltar dado: [INFORMAR: descricao].
5. MANTENHA nomes, CPFs, numeros, dados pessoais EXATAMENTE como estao. NAO altere nenhum dado.
6. TEXTO PURO sem markdown. NAO use asteriscos (*), hashtags (#), tracos (---). Para titulos, escreva em CAIXA ALTA. Paragrafos separados por linha em branco.
7. CADA PARAGRAFO maximo 5 linhas. Separe cada ideia em paragrafo proprio.
8. NUNCA produza um rascunho curto. O MINIMO ABSOLUTO para qualquer minuta ou peticao e 15 PAGINAS completas (aproximadamente 7.500 palavras).
9. PROIBIDO entregar texto com menos de 15 paginas em minutas e peticoes. Desenvolva extensamente cada secao.
10. FORMATACAO ABNT: Titulos em CAIXA ALTA, negrito, justificados. Paragrafos justificados com RECUO DE 4CM na primeira linha. Citacoes recuadas 4cm pela esquerda. Assinatura CAIXA ALTA justificada.`;

const ACTION_PROMPTS: Record<string, string> = {
  resumir:     "Elabore RESUMO ESTRUTURADO do documento com as seguintes secoes:\n\n1. NATUREZA DA DEMANDA\n[descricao]\n\n2. FATOS PRINCIPAIS\n[datas, nomes, valores]\n\n3. FUNDAMENTOS JURIDICOS\n[bases legais e argumentos]\n\n4. CONCLUSAO E PEDIDO\n[resultado pretendido]\n\nNao omita detalhes.\n\nDOCUMENTO:\n{{texto}}",
  revisar:     "Analise erros gramaticais, concordancia, logica juridica. Sugira melhorias de redacao. Aponte omissoes e contradicoes.\n\nTEXTO:\n{{texto}}",
  refinar:     "Reescreva elevando linguagem para padrao de tribunais superiores. Melhore fluidez e vocabulario juridico.\n\nTEXTO:\n{{texto}}",
  simplificar: "Traduza para linguagem simples e acessivel, mantendo rigor tecnico. Cliente leigo deve entender.\n\nTEXTO:\n{{texto}}",
  minuta:      "Elabore PETICAO/MINUTA JURIDICA COMPLETA, EXTENSA E PROFISSIONAL com NO MINIMO 15 PAGINAS (7.500+ palavras). Inclua OBRIGATORIAMENTE todas as secoes: Endereçamento → Qualificação das partes → Dos Fatos (extenso, cronologico, minimo 8 paragrafos) → Do Direito (fundamentacao robusta, minimo 12 paragrafos, multiplas teses) → Da Jurisprudencia (cite precedentes) → Dos Pedidos (lista detalhada, minimo 8 pedidos) → Do Valor da Causa → Assinatura.\n\nATENCAO: MINIMO 15 PAGINAS COMPLETAS. PROIBIDO rascunho curto.\n\nINFORMACOES:\n{{texto}}",
  analisar:    "Elabore ANALISE JURIDICA:\n\n1. RISCOS PROCESSUAIS\n[analise]\n\n2. TESES FAVORAVEIS E CONTRARIAS\n[argumentos]\n\n3. JURISPRUDENCIA APLICAVEL\n[precedentes]\n\n4. PROXIMOS PASSOS\n[recomendacoes]\n\nDOCUMENTO:\n{{texto}}",
  "modo-estrito":   "Corrija APENAS erros gramaticais e de estilo. Nao altere estrutura ou conteudo.\n\nTEXTO:\n{{texto}}",
  "modo-redacao":   "Melhore o texto tornando-o mais profissional e persuasivo, mantendo todos dados e fatos.\n\nTEXTO:\n{{texto}}",
  "modo-interativo":"Identifique lacunas e pontos que precisam complementacao pelo advogado.\n\nTEXTO:\n{{texto}}",
};

const EFFORT_INSTRUCTIONS: Record<number, string> = {
  1: "ESFORCO: RAPIDO. Direto e objetivo. Versao concisa e funcional.",
  2: "ESFORCO: BASICO. Pontos principais bem desenvolvidos.",
  3: "ESFORCO: DETALHADO. Analise completa. Desenvolva cada argumento extensamente.",
  4: "ESFORCO: PROFUNDO. Fundamentacao robusta, nuances, toda legislacao relevante.",
  5: "ESFORCO: EXAUSTIVO. Todos os angulos, todas as teses, toda a jurisprudencia aplicavel. Maximo possivel.",
};

const AUTO_DETECT_PROVIDERS: [string, string, string][] = [
  ["gsk_",   "https://api.groq.com/openai/v1",                          "llama-3.3-70b-versatile"],
  ["sk-or-", "https://openrouter.ai/api/v1",                            "openai/gpt-4o-mini"],
  ["pplx-",  "https://api.perplexity.ai",                               "sonar-pro"],
  ["AIza",   "https://generativelanguage.googleapis.com/v1beta/openai", "gemini-2.0-flash"],
  ["xai-",   "https://api.x.ai/v1",                                     "grok-2-latest"],
  ["sk-ant", "https://api.anthropic.com/v1",                            "claude-haiku-4-20250514"],
  ["sk-",    "https://api.openai.com/v1",                               "gpt-4o-mini"],
];

function autoDetect(key: string): { url: string; model: string } | null {
  const k = (key || "").trim();
  for (const [prefix, url, model] of AUTO_DETECT_PROVIDERS) {
    if (k.startsWith(prefix)) return { url, model };
  }
  return null;
}

function buildSystemPrompt(effort: number, verbosity: "curta" | "longa" = "longa"): string {
  const instr = EFFORT_INSTRUCTIONS[effort] || EFFORT_INSTRUCTIONS[3];
  const verbInstr = verbosity === "curta"
    ? "TAMANHO: CONCISO. Direto ao ponto. Sem repeticoes."
    : "TAMANHO: COMPLETO. Desenvolva cada argumento extensamente. Minimo 15 paginas para minutas e peticoes.";
  return SYSTEM_PROMPT + `\n\n${instr}\n${verbInstr}`;
}

function effortToMaxTokens(effort: number, verbosity: "curta" | "longa"): number {
  const base: Record<number, number> = { 1: 8192, 2: 16384, 3: 32768, 4: 65536, 5: 131072 };
  const tokens = base[effort] || 16384;
  return verbosity === "curta" ? Math.min(tokens, 32768) : tokens;
}

async function streamOpenAI(
  res: any,
  url: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
) {
  const isGroq = url.includes("groq.com");
  const isPplx = url.includes("perplexity.ai");
  const effectiveMax = isGroq ? Math.min(maxTokens, 32000) : isPplx ? Math.min(maxTokens, 8000) : maxTokens;

  const cleanUrl = url.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
  const client = new OpenAI({ apiKey, baseURL: cleanUrl });

  const stream = await client.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: true,
    max_tokens: effectiveMax,
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
}

async function streamOpenAIMessages(
  res: any,
  url: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
) {
  const isGroq = url.includes("groq.com");
  const isPplx = url.includes("perplexity.ai");
  const effectiveMax = isGroq ? Math.min(maxTokens, 32000) : isPplx ? Math.min(maxTokens, 8000) : maxTokens;

  const cleanUrl = url.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "");
  const client = new OpenAI({ apiKey, baseURL: cleanUrl });

  const stream = await client.chat.completions.create({
    model,
    messages: messages as any,
    stream: true,
    max_tokens: effectiveMax,
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
}

async function streamGeminiBuiltin(
  res: any,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
) {
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseUrl || !apiKey) throw new Error("Integração de IA não configurada no servidor.");

  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    stream: true,
    max_tokens: Math.min(maxTokens, 16384),
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
}

async function streamGeminiBuiltinMessages(
  res: any,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
) {
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey  = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseUrl || !apiKey) throw new Error("Integração de IA não configurada no servidor.");

  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const stream = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages as any,
    stream: true,
    max_tokens: Math.min(maxTokens, 16384),
    temperature: 0.7,
  });

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content || "";
    if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
  }
}

// ─── POST /api/legal/process ──────────────────────────────────────────────────
// Processa texto jurídico com ação específica (streaming SSE)
// Body: { text, action, effortLevel?, customKey?, customUrl?, customModel?, jurisText? }
router.post("/legal/process", async (req, res) => {
  try {
    const {
      text, action, effortLevel, verbosity,
      customKey, customUrl, customModel,
      jurisText,
    } = req.body as {
      text: string;
      action: string;
      effortLevel?: number;
      verbosity?: "curta" | "longa";
      customKey?: string;
      customUrl?: string;
      customModel?: string;
      jurisText?: string;
    };

    if (!text?.trim()) {
      res.status(400).json({ message: "Texto é obrigatório." });
      return;
    }

    const effort = Math.min(5, Math.max(1, Number(effortLevel) || 3));
    const verb: "curta" | "longa" = verbosity === "curta" ? "curta" : "longa";
    const maxTokens = effortToMaxTokens(effort, verb);

    // Aceita prompt customizado (ações do usuário)
    const { customPrompt } = req.body as { customPrompt?: string };
    const template = customPrompt
      ? customPrompt + "\n\nTEXTO:\n{{texto}}"
      : ACTION_PROMPTS[action];
    if (!template) {
      res.status(400).json({ message: `Ação desconhecida: ${action}` });
      return;
    }

    const jurisPart = jurisText?.trim()
      ? `\n\nJURISPRUDENCIA FORNECIDA PELO ADVOGADO (cite literalmente):\n${jurisText.trim()}`
      : "";

    const fullText = text.trim() + jurisPart;
    const userPrompt = template.replace("{{texto}}", fullText);
    const systemPrompt = buildSystemPrompt(effort, verb);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const cleanKey = (customKey || "").trim();
    const cleanUrl = (customUrl || "").trim();
    const cleanModel = (customModel || "").trim();

    if (cleanKey) {
      // Modo Chave Própria — tudo server-side, sem expor dados no browser
      const detected = autoDetect(cleanKey);
      const url   = cleanUrl  || detected?.url   || "https://api.openai.com/v1";
      const model = cleanModel || detected?.model || "gpt-4o-mini";
      res.write(`data: ${JSON.stringify({ mode: "custom" })}\n\n`);
      await streamOpenAI(res, url, cleanKey, model, systemPrompt, userPrompt, maxTokens);
    } else {
      // Modo Demo — usa integração Gemini/OpenAI do servidor (gratuita)
      res.write(`data: ${JSON.stringify({ mode: "demo" })}\n\n`);
      await streamGeminiBuiltin(res, systemPrompt, userPrompt, maxTokens);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: any) {
    logger.error({ err }, "Erro /legal/process");
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || "Erro interno." });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message || "Erro interno." })}\n\n`);
      res.end();
    }
  }
});

// ─── POST /api/legal/refine ───────────────────────────────────────────────────
// Refinamento via chat (streaming SSE)
// Body: { messages, effortLevel?, customKey?, customUrl?, customModel? }
router.post("/legal/refine", async (req, res) => {
  try {
    const {
      messages, effortLevel, verbosity,
      customKey, customUrl, customModel,
    } = req.body as {
      messages: Array<{ role: string; content: string }>;
      effortLevel?: number;
      verbosity?: "curta" | "longa";
      customKey?: string;
      customUrl?: string;
      customModel?: string;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ message: "Histórico de mensagens obrigatório." });
      return;
    }

    const effort = Math.min(5, Math.max(1, Number(effortLevel) || 3));
    const verb: "curta" | "longa" = verbosity === "curta" ? "curta" : "longa";
    const maxTokens = effortToMaxTokens(effort, verb);

    const systemMsg = { role: "system", content: buildSystemPrompt(effort, verb) };
    const allMessages = [systemMsg, ...messages];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const cleanKey = (customKey || "").trim();
    const cleanUrl = (customUrl || "").trim();
    const cleanModel = (customModel || "").trim();

    if (cleanKey) {
      const detected = autoDetect(cleanKey);
      const url   = cleanUrl  || detected?.url   || "https://api.openai.com/v1";
      const model = cleanModel || detected?.model || "gpt-4o-mini";
      await streamOpenAIMessages(res, url, cleanKey, model, allMessages, maxTokens);
    } else {
      await streamGeminiBuiltinMessages(res, allMessages, maxTokens);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err: any) {
    logger.error({ err }, "Erro /legal/refine");
    if (!res.headersSent) {
      res.status(500).json({ message: err.message || "Erro interno." });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message || "Erro interno." })}\n\n`);
      res.end();
    }
  }
});

export default router;
