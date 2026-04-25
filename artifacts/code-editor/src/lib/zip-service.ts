import JSZip from "jszip";
import { saveAs } from "file-saver";

// ── Exportar como ZIP ─────────────────────────────────────────────────────────
export async function exportAsZip(
  files: Record<string, string>,
  projectName: string = "projeto"
): Promise<void> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const blob = await zip.generateAsync({ type: "blob" });
  saveAs(blob, `${projectName}.zip`);
}

// ── Gerar ZIP como base64 (para enviar ao Drive) ───────────────────────────
export async function generateZipBase64(
  files: Record<string, string>
): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  const uint8 = await zip.generateAsync({ type: "uint8array" });
  let binary = "";
  for (let i = 0; i < uint8.byteLength; i++) {
    binary += String.fromCharCode(uint8[i]);
  }
  return btoa(binary);
}

// ── Importar de ZIP ───────────────────────────────────────────────────────────
export async function importFromZip(
  file: File
): Promise<Record<string, string>> {
  const name = file.name.toLowerCase();

  // .tar.gz / .tgz / .tar — usar o parser tar nativo
  if (name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar")) {
    return importFromTar(file);
  }

  // .zip — usar JSZip
  const zip = await JSZip.loadAsync(file);
  const files: Record<string, string> = {};
  const promises: Promise<void>[] = [];

  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir) {
      const promise = zipEntry.async("string").then((content) => {
        files[relativePath] = content;
      });
      promises.push(promise);
    }
  });

  await Promise.all(promises);
  return stripTopLevelFolder(files);
}

// ── Importar de TAR / TAR.GZ ──────────────────────────────────────────────────
async function importFromTar(file: File): Promise<Record<string, string>> {
  const name = file.name.toLowerCase();
  const raw = await file.arrayBuffer();
  let tarBuffer: ArrayBuffer;

  if (name.endsWith(".tar.gz") || name.endsWith(".tgz")) {
    tarBuffer = await decompressGzip(raw);
  } else {
    tarBuffer = raw;
  }

  return parseTar(tarBuffer);
}

// Descompressão gzip usando DecompressionStream nativo do browser
async function decompressGzip(compressed: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  writer.write(new Uint8Array(compressed));
  writer.close();
  return new Response(stream.readable).arrayBuffer();
}

// Parser tar puro em JavaScript (formato POSIX/ustar)
function parseTar(buffer: ArrayBuffer): Record<string, string> {
  const bytes = new Uint8Array(buffer);
  const files: Record<string, string> = {};
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let offset = 0;

  const readStr = (start: number, len: number) =>
    decoder.decode(bytes.slice(start, start + len)).replace(/\0+$/, "").trim();

  const parseOctal = (start: number, len: number) =>
    parseInt(readStr(start, len) || "0", 8) || 0;

  while (offset + 512 <= bytes.length) {
    const header = offset;

    // Bloco vazio = fim do arquivo
    if (bytes[header] === 0 && bytes[header + 1] === 0) {
      offset += 512;
      continue;
    }

    let name = readStr(header, 100);
    const typeflag = readStr(header + 156, 1);
    const size = parseOctal(header + 124, 12);

    // Prefixo ustar (POSIX)
    const prefix = readStr(header + 345, 155);
    if (prefix) name = prefix + "/" + name;

    offset += 512;

    const isRegularFile = typeflag === "0" || typeflag === "" || typeflag === "\0";

    if (isRegularFile && size > 0 && name) {
      // Limita a 10MB por arquivo para não travar o browser
      const limit = Math.min(size, 10 * 1024 * 1024);
      const content = decoder.decode(bytes.slice(offset, offset + limit));
      // Normaliza o path (remove "./" inicial)
      const cleanName = name.replace(/^\.\//, "");
      if (cleanName && !cleanName.endsWith("/")) {
        files[cleanName] = content;
      }
    }

    // Avança para o próximo bloco (alinhado em 512 bytes)
    offset += Math.ceil(size / 512) * 512;
  }

  return stripTopLevelFolder(files);
}

// Remove pasta raiz única se todos os arquivos estiverem dentro dela
// Ex: "meu-projeto/src/index.ts" → "src/index.ts"
function stripTopLevelFolder(files: Record<string, string>): Record<string, string> {
  const keys = Object.keys(files);
  if (keys.length === 0) return files;

  const firstSlash = keys[0].indexOf("/");
  if (firstSlash <= 0) return files;

  const prefix = keys[0].slice(0, firstSlash + 1);
  const allHavePrefix = keys.every(k => k.startsWith(prefix));

  if (!allHavePrefix) return files;

  // Verifica se é só uma pasta raiz (não "src/" ou "public/" que são pastas reais do projeto)
  const topLevel = prefix.slice(0, -1);
  const isTechnicalFolder = ["src", "public", "lib", "dist", "components", "pages", "app"].includes(topLevel);
  if (isTechnicalFolder) return files;

  const stripped: Record<string, string> = {};
  for (const [k, v] of Object.entries(files)) {
    stripped[k.slice(prefix.length)] = v;
  }
  return stripped;
}
