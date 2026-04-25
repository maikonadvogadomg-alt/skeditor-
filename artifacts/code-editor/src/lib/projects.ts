export interface Project {
  id: string;
  name: string;
  files: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

// ── Metadados sem arquivos (para o índice geral) ──────────────────────────────
interface ProjectMeta {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  fileCount?: number;
  sizeBytes?: number;
}

const INDEX_KEY   = "sk-editor-projects";   // apenas metadados (sem arquivos)
const CURRENT_KEY = "sk-editor-current";
const FILES_PREFIX = "sk-proj-files-";       // arquivos de cada projeto separados

// ── Helpers de tamanho ───────────────────────────────────────────────────────
function calcSize(files: Record<string, string>): number {
  return Object.values(files).reduce((a, v) => a + v.length, 0);
}

// ── Salvar arquivos de um projeto (chave separada) ───────────────────────────
function saveProjectFiles(id: string, files: Record<string, string>): void {
  const key = FILES_PREFIX + id;
  try {
    localStorage.setItem(key, JSON.stringify(files));
  } catch {
    // Fallback: salva sem os arquivos maiores (PLANO.md, MANUAL.md, etc.)
    try {
      const trimmed: Record<string, string> = {};
      for (const [k, v] of Object.entries(files)) {
        if (v.length < 100_000) trimmed[k] = v;  // ignora arquivos > 100KB
      }
      localStorage.setItem(key, JSON.stringify(trimmed));
    } catch {
      // Se ainda falhar, tenta salvar só metadados (arquivos vazios)
      try {
        const empty: Record<string, string> = {};
        for (const k of Object.keys(files)) empty[k] = "";
        localStorage.setItem(key, JSON.stringify(empty));
      } catch { /* sem espaço mesmo */ }
    }
  }
}

// ── Carregar arquivos de um projeto ──────────────────────────────────────────
function loadProjectFiles(id: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(FILES_PREFIX + id);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// ── Índice de metadados ───────────────────────────────────────────────────────
function loadIndex(): ProjectMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Suporta formato antigo (com files embutido) e novo (só metadados)
    return (parsed as any[]).map(p => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      fileCount: p.fileCount ?? (p.files ? Object.keys(p.files).length : 0),
      sizeBytes: p.sizeBytes ?? 0,
    }));
  } catch {
    return [];
  }
}

function saveIndex(metas: ProjectMeta[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(metas));
  } catch {
    // Mantém apenas os 10 mais recentes se falhar
    try {
      const slim = metas
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 10);
      localStorage.setItem(INDEX_KEY, JSON.stringify(slim));
    } catch { /* ignora */ }
  }
}

// ── API Pública ───────────────────────────────────────────────────────────────

/**
 * Carrega todos os projetos com arquivos.
 * Migra formato antigo automaticamente (arquivos embutidos no índice).
 */
export function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed: any[] = JSON.parse(raw);

    return parsed.map(p => {
      let files: Record<string, string>;

      if (p.files && Object.keys(p.files).length > 0) {
        // Formato antigo: arquivos embutidos no índice — migra para novo formato
        files = p.files;
        saveProjectFiles(p.id, files);
      } else {
        files = loadProjectFiles(p.id);
      }

      return {
        id: p.id,
        name: p.name,
        files,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Salva todos os projetos — arquivos separados do índice.
 */
export function saveProjects(projects: Project[]): void {
  // Salva arquivos de cada projeto separadamente
  for (const p of projects) {
    saveProjectFiles(p.id, p.files);
  }

  // Salva apenas metadados no índice geral
  const metas: ProjectMeta[] = projects.map(p => ({
    id: p.id,
    name: p.name,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    fileCount: Object.keys(p.files).length,
    sizeBytes: calcSize(p.files),
  }));
  saveIndex(metas);
}

export function getCurrentProjectId(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentProjectId(id: string | null): void {
  if (id) localStorage.setItem(CURRENT_KEY, id);
  else localStorage.removeItem(CURRENT_KEY);
}

export function createProject(name: string, files: Record<string, string>): Project {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name,
    files,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function upsertProject(projects: Project[], project: Project): Project[] {
  const idx = projects.findIndex(p => p.id === project.id);
  if (idx >= 0) {
    const next = [...projects];
    next[idx] = { ...project };
    return next;
  }
  return [project, ...projects];
}

export function duplicateProject(project: Project): Project {
  return {
    ...project,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    name: project.name + " (cópia)",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

export function getProjectStats(files: Record<string, string>) {
  const count = Object.keys(files).length;
  const size = calcSize(files);
  return { count, size: size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B` };
}
