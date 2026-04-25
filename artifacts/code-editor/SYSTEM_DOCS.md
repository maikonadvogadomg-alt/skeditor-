# SK Code Editor — Documentação do Sistema

> Versão atual · Editor de código mobile-first PWA com IA integrada

---

## Índice

1. [Visão Geral](#visão-geral)
2. [Arquitetura](#arquitetura)
3. [Gerenciamento de Projetos](#gerenciamento-de-projetos)
4. [Layout do Editor](#layout-do-editor)
5. [Assistente de IA](#assistente-de-ia)
6. [Terminal Integrado](#terminal-integrado)
7. [Preview ao Vivo](#preview-ao-vivo)
8. [GitHub e Git](#github-e-git)
9. [Voz e TTS](#voz-e-tts)
10. [PWA e Instalação](#pwa-e-instalação)
11. [Funções da IA — Capacidades e Limites](#funções-da-ia)
12. [Estrutura de Arquivos do Projeto](#estrutura-de-arquivos)

---

## Visão Geral

SK Code Editor é um editor de código completo que roda no navegador, sem instalação de backend. Funciona como PWA (Progressive Web App) instalável em Android e iOS. Todo o estado do projeto é salvo no `localStorage` do navegador.

**Stack:** React 18 + Vite + TypeScript + Monaco Editor + Tailwind CSS

---

## Arquitetura

```
artifacts/code-editor/
├── src/
│   ├── App.tsx                    # Roteamento: splash vs editor
│   ├── components/
│   │   ├── EditorLayout.tsx       # Layout 3 colunas (files|editor|AI)
│   │   ├── AIChat.tsx             # Painel de IA com escopo e voz
│   │   ├── FileTree.tsx           # Árvore de arquivos com menu de contexto
│   │   ├── CodeEditor.tsx         # Monaco Editor wrapper
│   │   ├── Terminal.tsx           # Terminal simulado (100+ comandos)
│   │   ├── Preview.tsx            # Iframe para preview de HTML
│   │   ├── GitHubPanel.tsx        # Clone / push para GitHub
│   │   ├── TemplateSelector.tsx   # Splash screen + lista de projetos
│   │   ├── QuickPrompt.tsx        # Botão flutuante de IA rápida
│   │   └── VoiceMode.tsx          # Interface de voz interativa
│   └── lib/
│       ├── virtual-fs.ts          # Sistema de arquivos virtual (VFS)
│       ├── ai-service.ts          # 4 slots de API de IA configuráveis
│       ├── tts-service.ts         # TTS + reconhecimento de voz
│       ├── templates.ts           # 6 templates de projeto
│       ├── projects.ts            # Multi-projeto no localStorage
│       ├── zip-service.ts         # Importar/Exportar ZIP
│       └── store.ts               # Estado persistido
```

---

## Gerenciamento de Projetos

### Criar projeto
- **Com IA:** Descreva em texto → a IA gera todos os arquivos automaticamente
- **Template:** 6 templates prontos (HTML, React, Node, Python, etc.)
- **Importar ZIP:** Sobe um arquivo .zip com a estrutura de pastas

### Lista de projetos (painel esquerdo da splash screen)
- Busca por nome
- Abrir, Copiar, Baixar ZIP, Excluir (menu ⋮)
- Salvo automaticamente no `localStorage`

### Auto-save
- Salva a cada 8 segundos
- Salva a cada alteração no VFS

---

## Layout do Editor

### Estrutura 3 colunas

```
[Barra de Ícones] [Painel de Arquivos] | [Editor de Código] | [Painel de IA]
```

| Zona | Largura | Conteúdo |
|------|---------|----------|
| Strip de ícones | 40px fixo | Files, GitHub, Terminal, Preview |
| Painel esquerdo | 240px (colapsável) | Árvore de arquivos ou GitHub |
| Editor central | flex-1 | Abas + Monaco Editor + status bar |
| Painel de IA | 288px (colapsável) | Chat, escopo, sugestões |
| Painel inferior | ~55% altura | Terminal ou Preview |

### Barra de status (inferior)
- **Desfazer / Refazer** (Undo2/Redo2)
- **Navegação histórica** ← → entre arquivos visitados
- **Nome do arquivo ativo**
- **Seletor de codificação** (UTF-8, UTF-16, Latin-1, ASCII)
- **Seletor de linguagem** (25 linguagens)
- **Botão ▶ Run** (verde) — executa o arquivo ativo no terminal ou preview

### Ações do menu (☰)
- Novo Projeto
- Importar ZIP
- Exportar ZIP
- GitHub
- **Gerar Documentação** → cria `DOCS.md` e `README.md` no projeto
- Limpar Projeto

---

## Assistente de IA

### Configuração (4 Slots)
Cada slot aceita: **OpenAI**, **Anthropic (Claude)**, **Google (Gemini)** ou **Custom / OpenRouter**

Configure em: painel de IA → ⚙️ Configurações

```
localStorage key: "ai-key-slots"
```

### Escopos de contexto da IA

| Escopo | O que a IA recebe |
|--------|------------------|
| 🌐 Projeto | Todos os arquivos (até 20, 12.000 chars cada) |
| 📁 Pasta | Arquivos da pasta do arquivo ativo |
| 📄 Arquivo | Apenas o arquivo ativo (até 8.000 chars) |
| ○ Nenhum | Nenhum arquivo — conversa livre |

### Formato de resposta da IA

**Criar/editar arquivo** (aplicado automaticamente):
```
```filepath:caminho/arquivo.ext
conteúdo completo aqui
```
```

**Executar comando** (botão "Executar no Terminal"):
```
```bash
npm install express
```
```

### Tokens
- Máximo de saída: **16.000 tokens** por resposta
- Contexto enviado: até **12.000 chars** de arquivos

### Bug Report
Botão 🐛 no cabeçalho do painel de IA → cria `.bugs/bug-TIMESTAMP.md` com contexto da conversa.

---

## Terminal Integrado

Terminal simulado em JavaScript com suporte a:

### Comandos principais
| Comando | Descrição |
|---------|-----------|
| `node arquivo.js` | Executa JS (simulado) |
| `python arquivo.py` | Executa Python (simulado) |
| `npm install pacote` | Instala pacote npm (simulado) |
| `pip install pacote` | Instala pacote pip (simulado) |
| `ls`, `cd`, `mkdir`, `rm` | Navegação VFS |
| `cat arquivo` | Mostra conteúdo |
| `git init`, `git add`, `git commit` | Comandos Git |
| `youtube setup` | Gera projeto ytdl-core |
| `db neon`, `db supabase` | Templates de banco de dados |
| `help` | Lista todos os comandos |

### Execução em background
O terminal mantém estado mesmo ao trocar de aba. O componente fica montado na memória.

---

## Preview ao Vivo

- **HTML:** renderiza em iframe sandboxado
- **JavaScript/TypeScript:** executa no terminal (simulado)
- **Outros:** abre o terminal com o comando correspondente

Acesse via: ícone 👁 na barra lateral ou botão ▶ Run na status bar.

---

## GitHub e Git

### Painel GitHub
- Clone de repositório público (via API GitHub)
- Push de alterações (requer token de acesso)
- Realiza commit diretamente pelo editor

### Requisitos
- Token GitHub com permissão `repo`
- Repositório público (clone sem token)

---

## Voz e TTS

### Entrada de voz (microfone)
- Clique no ícone 🎤 no input do chat de IA
- Usa Web Speech API (nativo do navegador)
- Idioma padrão: pt-BR

### Saída de voz (TTS)
- Ativado pelo ícone 🔊 no cabeçalho do chat
- Usa SpeechSynthesis API
- Configurável: idioma, velocidade
- Lê apenas a parte textual das respostas (ignora código)

### Modo Voz Interativo
- Botão "Modo Voz" no chat → interface dedicada de push-to-talk

---

## PWA e Instalação

O SK Code Editor é instalável como aplicativo nativo:

- **Android:** banner "Adicionar à tela inicial" automático
- **iOS/Safari:** menu compartilhar → "Adicionar à tela de início"
- **Desktop:** ícone de instalação na barra de endereços

### Manifest
```
public/manifest.json — nome, ícones, theme-color: #0d1117, display: standalone
```

---

## Funções da IA

### O que a IA pode fazer
✅ Criar arquivos completos e aplicá-los automaticamente no VFS  
✅ Editar arquivos existentes (gera o arquivo completo)  
✅ Sugerir comandos de terminal para o usuário executar  
✅ Instalar bibliotecas via npm/pip (comando no terminal)  
✅ Detectar bugs e sugerir correções  
✅ Gerar README, .gitignore, .env.example  
✅ Configurar bancos de dados (SQLite, PostgreSQL, MongoDB, Firebase, Supabase)  
✅ Implementar autenticação (JWT, OAuth2, bcrypt)  
✅ Criar APIs REST completas  
✅ Gerar código em 25+ linguagens  

### Limitações da IA
❌ Não executa código diretamente (apenas sugere comandos)  
❌ Não acessa a internet em tempo real (usa conhecimento do modelo)  
❌ Não pode instalar binários no sistema  
❌ Não pode ler arquivos > 12.000 chars por vez (trunca)  
❌ Limitado a 20 arquivos por contexto no escopo "Projeto"  
❌ Não tem acesso ao sistema operacional real  

---

## Estrutura de Arquivos

### VFS (Virtual File System)
Todos os arquivos vivem na memória e no `localStorage`. Não há disco real.

```
localStorage keys:
  "sk-editor-projects"   → lista de projetos serializados
  "sk-editor-current"    → ID do projeto ativo
  "ai-key-slots"         → configurações de API de IA
  "tts-config"           → configurações de voz
```

### Pasta de Bugs
Ao clicar 🐛 no chat de IA:
```
.bugs/
  bug-2026-01-15T14-30-00.md
  bug-2026-01-16T09-12-35.md
```

### Documentação gerada automaticamente
Ao clicar "Gerar Documentação" no menu ☰:
```
DOCS.md    → estrutura do projeto, deps, scripts, limites da IA
README.md  → arquivo padrão de repositório
```

---

*Documentação gerada em Abril/2026 · SK Code Editor v1.0*
