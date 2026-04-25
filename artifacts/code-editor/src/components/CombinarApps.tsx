import { useState, useCallback } from "react";
import { Plus, Trash2, Wand2, Copy, CheckCheck, Send } from "lucide-react";

interface AppEntry {
  id: string;
  name: string;
  url: string;
  works: string;
  broken: string;
}

interface CombinarAppsProps {
  onSendToJasmim: (prompt: string) => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function emptyApp(): AppEntry {
  return { id: uid(), name: "", url: "", works: "", broken: "" };
}

const FIELD_STYLE =
  "w-full bg-[#141c0d] border border-[#3d6e2a] rounded-lg px-3 py-2 text-sm text-[#a8d5a2] placeholder-[#3d6e2a] outline-none focus:border-[#5aab56] focus:ring-1 focus:ring-[#5aab56]/20 resize-none";

const LABEL_STYLE = "block text-[#5aab56] text-xs font-semibold mb-1";

export default function CombinarApps({ onSendToJasmim }: CombinarAppsProps) {
  const [apps, setApps] = useState<AppEntry[]>([emptyApp()]);
  const [goal, setGoal] = useState("");
  const [generatedPrompt, setGeneratedPrompt] = useState("");
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState(false);

  const addApp = useCallback(() => {
    setApps(prev => [...prev, emptyApp()]);
    setGeneratedPrompt("");
  }, []);

  const removeApp = useCallback((id: string) => {
    setApps(prev => prev.filter(a => a.id !== id));
    setGeneratedPrompt("");
  }, []);

  const updateApp = useCallback((id: string, field: keyof Omit<AppEntry, "id">, value: string) => {
    setApps(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    setGeneratedPrompt("");
  }, []);

  const generatePrompt = useCallback(() => {
    const filledApps = apps.filter(a => a.name.trim() || a.url.trim() || a.works.trim() || a.broken.trim());
    if (filledApps.length === 0) return;

    const appDescriptions = filledApps.map((a, i) => {
      const lines: string[] = [];
      lines.push(`App ${i + 1}${a.name ? ` — ${a.name}` : ""}:`);
      if (a.url.trim()) lines.push(`  URL no Replit: ${a.url.trim()}`);
      if (a.works.trim()) lines.push(`  ✅ O que funciona bem: ${a.works.trim()}`);
      if (a.broken.trim()) lines.push(`  ❌ O que não funciona: ${a.broken.trim()}`);
      return lines.join("\n");
    }).join("\n\n");

    const goalSection = goal.trim()
      ? `\nObjetivo do app final: ${goal.trim()}\n`
      : "";

    const prompt = `Tenho ${filledApps.length} app${filledApps.length > 1 ? "s" : ""} no Replit e quero combiná-los num único projeto que aproveite o que já funciona em cada um.
${goalSection}
Aqui estão os apps e o que funciona em cada um:

${appDescriptions}

Por favor:
1. Analise o que cada app tem de melhor
2. Crie um único projeto unificado aproveitando o código que já funciona
3. Não reescreva do zero o que já está funcionando — aproveite o código existente
4. Para cada parte que for unir, explique de qual app está vindo
5. Ao final, mostre como rodar o projeto unificado (npm install && npm start ou equivalente)

Comece me dizendo qual será a estrutura do projeto unificado e como você vai organizar os arquivos.`;

    setGeneratedPrompt(prompt);
    setSent(false);
    setCopied(false);
  }, [apps, goal]);

  const copyPrompt = useCallback(() => {
    if (!generatedPrompt) return;
    navigator.clipboard.writeText(generatedPrompt).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generatedPrompt]);

  const sendToJasmim = useCallback(() => {
    if (!generatedPrompt) return;
    onSendToJasmim(generatedPrompt);
    setSent(true);
    setTimeout(() => setSent(false), 3000);
  }, [generatedPrompt, onSendToJasmim]);

  const filledCount = apps.filter(a => a.name.trim() || a.url.trim() || a.works.trim() || a.broken.trim()).length;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0f1a0a] text-[#a8d5a2]">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-[#2d4a1e] shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xl">🔗</span>
          <h1 className="text-[#7ec87a] font-bold text-base">Combinar Apps</h1>
        </div>
        <p className="text-[#6b8f68] text-xs leading-relaxed">
          Preencha os apps que você quer unir. O assistente monta o prompt ideal para a Jasmim combinar tudo num projeto só.
        </p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Goal field */}
        <div>
          <label className={LABEL_STYLE}>🎯 Objetivo do app final (opcional)</label>
          <textarea
            value={goal}
            onChange={e => { setGoal(e.target.value); setGeneratedPrompt(""); }}
            placeholder="Ex: Um app de gestão de processos jurídicos com login, dashboard e relatórios em PDF"
            rows={2}
            className={FIELD_STYLE}
          />
        </div>

        {/* App list */}
        <div className="space-y-3">
          {apps.map((app, idx) => (
            <div
              key={app.id}
              className="bg-[#0d1309] border border-[#2d4a1e] rounded-xl p-3 space-y-2"
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[#7ec87a] text-xs font-bold uppercase tracking-wider">
                  App {idx + 1}
                </span>
                {apps.length > 1 && (
                  <button
                    onClick={() => removeApp(app.id)}
                    className="p-1 rounded-lg text-[#5a3a3a] hover:text-[#d47070] hover:bg-[#2d0d0d] transition-colors"
                    title="Remover app"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={LABEL_STYLE}>Nome do app</label>
                  <input
                    type="text"
                    value={app.name}
                    onChange={e => updateApp(app.id, "name", e.target.value)}
                    placeholder="Ex: app-login"
                    className={FIELD_STYLE}
                  />
                </div>
                <div>
                  <label className={LABEL_STYLE}>URL no Replit (opcional)</label>
                  <input
                    type="url"
                    value={app.url}
                    onChange={e => updateApp(app.id, "url", e.target.value)}
                    placeholder="https://replit.com/@..."
                    className={FIELD_STYLE}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_STYLE}>✅ O que funciona bem</label>
                <textarea
                  value={app.works}
                  onChange={e => updateApp(app.id, "works", e.target.value)}
                  placeholder="Ex: O login com Google funciona. O sistema de autenticação está completo."
                  rows={2}
                  className={FIELD_STYLE}
                />
              </div>

              <div>
                <label className={LABEL_STYLE}>❌ O que não funciona (opcional)</label>
                <textarea
                  value={app.broken}
                  onChange={e => updateApp(app.id, "broken", e.target.value)}
                  placeholder="Ex: Os relatórios em PDF não geram. O painel de admin está incompleto."
                  rows={2}
                  className={FIELD_STYLE}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Add app button */}
        <button
          onClick={addApp}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-[#3d6e2a] rounded-xl text-[#5aab56] text-sm hover:border-[#5aab56] hover:bg-[#0d2210] transition-colors"
        >
          <Plus size={15} />
          Adicionar outro app
        </button>

        {/* Generate button */}
        <button
          onClick={generatePrompt}
          disabled={filledCount === 0}
          className="w-full flex items-center justify-center gap-2 py-3 bg-[#2d4a1e] hover:bg-[#3d5e2a] disabled:opacity-40 disabled:cursor-not-allowed text-[#7ec87a] font-bold text-sm rounded-xl transition-colors"
        >
          <Wand2 size={15} />
          Gerar Prompt para Jasmim
        </button>

        {/* Generated prompt */}
        {generatedPrompt && (
          <div className="bg-[#0d1309] border border-[#2d5a1e] rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-[#1a3d14] border-b border-[#2d5a1e]">
              <span className="text-[#7ec87a] text-xs font-bold">✨ Prompt gerado</span>
              <button
                onClick={copyPrompt}
                className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-[#2d4a1e] text-[#7ec87a] hover:bg-[#3d5e2a] transition-colors"
              >
                {copied
                  ? <><CheckCheck size={12} /> Copiado!</>
                  : <><Copy size={12} /> Copiar</>
                }
              </button>
            </div>
            <pre className="px-3 py-3 text-xs text-[#8cba89] font-mono leading-relaxed whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
              {generatedPrompt}
            </pre>
            <div className="px-3 py-2.5 border-t border-[#2d5a1e]">
              <button
                onClick={sendToJasmim}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 ${
                  sent
                    ? "bg-green-600/30 text-green-300 border border-green-500/25"
                    : "bg-[#1e5c9e] hover:bg-[#2a73c5] text-white"
                }`}
              >
                {sent
                  ? <><CheckCheck size={14} /> Enviado para a Jasmim!</>
                  : <><Send size={14} /> Enviar para a Jasmim</>
                }
              </button>
            </div>
          </div>
        )}

        {/* Tips */}
        <div className="bg-[#0d1a0a] border border-[#2d4a1e] rounded-xl p-3 space-y-2">
          <p className="text-[#5aab56] text-xs font-bold">💡 Dicas</p>
          <ul className="space-y-1">
            {[
              "Seja específico sobre o que funciona — mencione nomes de arquivos ou módulos se souber",
              "Você pode adicionar quantos apps precisar",
              "Depois de enviar para a Jasmim, ela vai analisar e unir os projetos",
              "Se quiser ajustar o prompt, edite os campos e clique em Gerar novamente",
            ].map((tip, i) => (
              <li key={i} className="flex gap-2 text-xs text-[#6b8f68]">
                <span className="text-[#3d6e2a] shrink-0">›</span>
                <span>{tip}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
