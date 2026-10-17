import express, { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { createServer as createViteServer } from 'vite';
import { analisarPacoteReal } from './backend-analyzer.js';

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '50mb' }));

// Configuração do Multer para receber arquivos
const uploadDir = path.join(process.cwd(), 'tmp');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir });

// Carregar o Prompt CAROL
const safePrompt = fs.readFileSync('./src/prompts/carol-master.md', 'utf8');

// ==========================================
// ROTA DE ANÁLISE (APK/ZIP via JADX + IA)
// ==========================================
app.post('/api/analyze-architecture', upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Nenhum arquivo enviado para análise.' });
      return;
    }

    const projectName = String(req.body.projectName || 'Projeto Desconhecido');
    const provider = String(req.body.provider || process.env.AI_PROVIDER || 'ollama').toLowerCase();
    const userApiKey = String(req.body.apiKey || '').trim();
    const customBaseUrl = String(req.body.baseUrl || '').trim();
    const customModel = String(req.body.model || '').trim();

    console.log(`Iniciando extração real do arquivo: ${req.file.originalname}`);

    let dadosReais;
    try {
      dadosReais = analisarPacoteReal(req.file.path);
    } finally {
      // Apaga o upload temporário mesmo quando o parser falha.
      try { fs.unlinkSync(req.file.path); } catch { /* arquivo já removido */ }
    }

    if (dadosReais.erro) {
      res.status(422).json({ error: 'Erro na extração: ' + dadosReais.erro });
      return;
    }
    if (!dadosReais.manifest && !dadosReais.codigo.trim()) {
      res.status(422).json({ error: 'O arquivo foi recebido, mas não foi possível extrair conteúdo analisável. Para APK, verifique se JADX e Apktool estão instalados; para ZIP, confirme que ele contém arquivos de projeto.' });
      return;
    }

    const promptFinal = `Nome do projeto: ${projectName}\n\nAnalise somente as evidências reais abaixo. Diferencie observações, inferências e lacunas; não invente resultados.\n\n=== MANIFESTO ===\n${dadosReais.manifest.slice(0, 15000)}\n\n=== CÓDIGO / ESTRUTURA EXTRAÍDA ===\n${dadosReais.codigo.slice(0, 60000)}`;

    const providerDefaults: Record<string, { baseUrl: string; model: string; envKey: string }> = {
      ollama: { baseUrl: 'https://ollama.com/v1', model: 'gemma4:31b', envKey: 'OLLAMA_API_KEY' },
      nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'meta/llama-3.3-70b-instruct', envKey: 'NVIDIA_API_KEY' },
      openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY' },
      deepseek: { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', envKey: 'DEEPSEEK_API_KEY' },
      groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', envKey: 'GROQ_API_KEY' },
      custom: { baseUrl: '', model: '', envKey: 'CUSTOM_API_KEY' },
    };
    const config = providerDefaults[provider];
    if (!config) {
      res.status(400).json({ error: `Provedor de IA não suportado: ${provider}` });
      return;
    }
    const targetBaseUrl = (customBaseUrl || process.env[`${provider.toUpperCase()}_BASE_URL`] || config.baseUrl).replace(/\/+$/, '');
    const targetModel = customModel || process.env[`${provider.toUpperCase()}_MODEL`] || config.model;
    const targetApiKey = userApiKey || process.env[config.envKey] || '';

    if (!targetBaseUrl || !targetModel) {
      res.status(400).json({ error: `Configure a URL base e o modelo do provedor ${provider} antes de analisar.` });
      return;
    }
    // Ollama local pode não exigir chave; Ollama Cloud exige autenticação.
    const isLocalOllama = provider === 'ollama' && /localhost|127\.0\.0\.1/.test(targetBaseUrl);
    if (!targetApiKey && !isLocalOllama) {
      res.status(401).json({ error: `Chave de API ausente para ${provider}. Configure a chave no painel ou no ambiente do servidor (${config.envKey}).` });
      return;
    }

    console.log(`Enviando dados para o provedor: ${provider} (${targetModel})`);

    const completionsUrl = `${targetBaseUrl.replace(/\/+$/, '')}/chat/completions`;
    const llmRes = await fetch(completionsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(targetApiKey ? { 'Authorization': `Bearer ${targetApiKey}` } : {})
      },
      body: JSON.stringify({
        model: targetModel,
        messages: [
          { role: 'system', content: safePrompt },
          { role: 'user', content: promptFinal }
        ],
        temperature: 0.2,
        max_tokens: 8000,
      }),
    });

    if (!llmRes.ok) {
      const errText = await llmRes.text().catch(() => '');
      const detail = llmRes.status === 401 || llmRes.status === 403
        ? `O provedor ${provider} recusou a autenticação (HTTP ${llmRes.status}). Confira se a chave corresponde a esse provedor, se não expirou e se a URL base está correta. A chave não é exibida por segurança. Detalhe do provedor: ${errText.slice(0, 500)}`
        : `Falha no provedor ${provider} (HTTP ${llmRes.status}): ${errText.slice(0, 1000)}`;
      res.status(llmRes.status).json({ error: detail });
      return;
    }

    const llmData = await llmRes.json();
    let rawContent = llmData.choices?.[0]?.message?.content || '';
    
    // Limpeza do Markdown
    if (rawContent.includes('```json')) rawContent = rawContent.replace(/```json/g, '').replace(/```/g, '');
    
    let parsed;
    try {
      parsed = JSON.parse(rawContent.trim());
    } catch(e) {
      parsed = {
        overview: "Relatório CAROL baseado no código real.",
        techStack: [],
        architectureBreakdown: { pattern: "Ver relatório", dataFlow: "Ver relatório", modules: [] },
        stepByStepLogic: [],
        masterPrompt: rawContent,
        visualDifferentiationTips: "Ver relatório"
      };
    }

    res.json({ success: true, analysis: parsed });

  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno no servidor: ' + error.message });
  }
});

// ==========================================
// CONFIGURAÇÃO VITE E PRODUÇÃO
// ==========================================
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`CAROL Engine rodando na porta ${port}`);
  });
}

startServer().catch((err) => {
  console.error('Falha ao iniciar o servidor:', err);
});
