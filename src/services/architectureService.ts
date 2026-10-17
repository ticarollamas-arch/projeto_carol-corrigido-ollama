export interface ArchitectureAnalysis {
  overview: string;
  techStack: Array<{ name: string; category: string; role: string; necessity: string }>;
  architectureBreakdown: { pattern: string; dataFlow: string; modules: Array<{ name: string; purpose: string; responsibility: string }> };
  stepByStepLogic: Array<{ stepNumber: number; title: string; objective: string; keyTasks: string[]; pitfallsToAvoid: string }>;
  masterPrompt: string;
  visualDifferentiationTips: string;
}

export async function analyzeProjectArchitecture(
  projectName: string,
  file: File,
  
): Promise<ArchitectureAnalysis> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('projectName', projectName);

  // Preferências salvas no navegador; o segredo é enviado somente na requisição HTTPS.
  const readSetting = (...keys: string[]) => {
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value && value.trim()) return value.trim();
    }
    return '';
  };
  const provider = readSetting('ai_provider', 'aiProvider') || 'ollama';
  formData.append('provider', provider);
  // Nunca reutiliza automaticamente a chave de outro provedor: isso causa Unauthorized.
  formData.append('apiKey', readSetting('ai_api_key', `${provider}_api_key`));
  formData.append('baseUrl', readSetting('ai_base_url', 'ollama_base_url'));
  formData.append('model', readSetting('ai_model', 'ollama_model'));

  
  
  
  
  

  const response = await fetch('/api/analyze-architecture', {
    method: 'POST',
    body: formData, // Enviando o arquivo físico
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Falha na resposta do servidor' }));
    throw new Error(err.error || 'Erro desconhecido na análise');
  }

  const data = await response.json();
  return data.analysis;
}
