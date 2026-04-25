import { Router, type Request, type Response } from "express";
import OpenAI from "openai";

const router = Router();

function getOpenAI(): OpenAI {
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  const apiKey  = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!baseURL || !apiKey) throw new Error("AI Integrations OpenAI não configurado");
  return new OpenAI({ baseURL, apiKey });
}

// ── POST /api/voice/transcribe ─────────────────────────────────────────────
// Body: { audio: string (base64), mimeType?: string }
// Returns: { transcript: string }
router.post("/transcribe", async (req: Request, res: Response) => {
  try {
    const { audio, mimeType = "audio/webm" } = req.body;
    if (!audio) { res.status(400).json({ error: "Campo 'audio' (base64) obrigatório" }); return; }

    const openai = getOpenAI();
    const buffer = Buffer.from(audio, "base64");

    const ext = mimeType.includes("mp4") ? "m4a"
              : mimeType.includes("ogg")  ? "ogg"
              : mimeType.includes("wav")  ? "wav"
              : "webm";

    const file = new File([buffer], `audio.${ext}`, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      model: "gpt-4o-mini-transcribe",
      file,
      language: "pt",
      response_format: "text",
    });

    const transcript = typeof transcription === "string"
      ? transcription.trim()
      : (transcription as any).text?.trim() ?? "";

    res.json({ transcript });
  } catch (err: any) {
    console.error("[voice/transcribe]", err?.message);
    res.status(500).json({ error: err?.message ?? "Erro na transcrição" });
  }
});

// ── POST /api/voice/speak ──────────────────────────────────────────────────
// Body: { text: string, voice?: string }
// Returns: { audio: string (base64 MP3), transcript: string }
router.post("/speak", async (req: Request, res: Response) => {
  try {
    const { text, voice = "nova" } = req.body;
    if (!text) { res.status(400).json({ error: "Campo 'text' obrigatório" }); return; }

    const openai = getOpenAI();

    // gpt-audio-mini: único modelo de áudio disponível no proxy Replit
    const completion = await (openai.chat.completions as any).create({
      model: "gpt-audio-mini",
      modalities: ["text", "audio"],
      audio: { voice, format: "mp3" },
      messages: [
        {
          role: "system",
          content: "Você é a Jasmim, assistente de IA da SK Code Editor. Leia o texto a seguir em voz alta, de forma natural e expressiva, em português brasileiro. Não adicione nada ao texto — leia exatamente como está.",
        },
        { role: "user", content: text.slice(0, 4096) },
      ],
    });

    const audioData: string | undefined = completion.choices?.[0]?.message?.audio?.data;
    const transcript: string = completion.choices?.[0]?.message?.audio?.transcript ?? text;

    if (!audioData) {
      res.status(500).json({ error: "Modelo não retornou áudio" }); return;
    }

    res.json({ audio: audioData, transcript });
  } catch (err: any) {
    console.error("[voice/speak]", err?.message);
    res.status(500).json({ error: err?.message ?? "Erro na síntese de voz" });
  }
});

export default router;
