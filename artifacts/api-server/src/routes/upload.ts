import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

async function extractText(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  const ext = (filename || "").split(".").pop()?.toLowerCase() || "";

  // DOCX
  if (ext === "docx" || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || "";
  }

  // PDF — usa pdf-parse
  if (ext === "pdf" || mimetype === "application/pdf") {
    try {
      const pdfMod = await import("pdf-parse");
      const pdfParse: (buf: Buffer) => Promise<{ text: string }> =
        (pdfMod as any).default ?? (pdfMod as any);
      const data = await pdfParse(buffer);
      return data.text || "";
    } catch (e) {
      // fallback: extração simples por regex
      const str = buffer.toString("latin1");
      const matches = str.match(/\(([^\)]{5,})\)/g) || [];
      return matches.map(m => m.slice(1, -1)).join(" ");
    }
  }

  // Texto puro (.txt, .md, .rtf, .csv, .html, .json, etc.)
  return buffer.toString("utf-8");
}

// POST /api/upload/extract-text
// Campo "files" (múltiplos) ou "file" (único)
router.post(
  "/upload/extract-text",
  upload.array("files", 20),
  async (req, res) => {
    try {
      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        res.status(400).json({ message: "Nenhum arquivo enviado" });
        return;
      }

      const parts: string[] = [];
      for (const f of files) {
        try {
          const text = await extractText(f.buffer, f.mimetype, f.originalname);
          if (text.trim()) {
            if (files.length > 1) parts.push(`--- ${f.originalname} ---\n${text.trim()}`);
            else parts.push(text.trim());
          }
        } catch (e: any) {
          console.error("Erro ao extrair texto de", f.originalname, e.message);
        }
      }

      if (parts.length === 0) {
        res.status(422).json({ message: "Não foi possível extrair texto dos arquivos enviados." });
        return;
      }

      res.json({ text: parts.join("\n\n") });
    } catch (e: any) {
      console.error("Erro upload/extract-text:", e.message);
      res.status(500).json({ message: "Erro interno ao processar arquivo." });
    }
  },
);

export default router;
