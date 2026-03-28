// @ts-ignore
import crossSpawn from 'cross-spawn';
import type { AIProvider, AIResponse, AIMessage, AITool } from './baseProvider.js';

export class CLIProvider implements AIProvider {
  private cliTool: string;
  private providerId: string;

  constructor(cliTool: string, providerId: string) {
    this.cliTool = cliTool;
    this.providerId = providerId;
  }

  async listModels(): Promise<string[]> {
    return [this.cliTool];
  }

  async syncModels(): Promise<{ success: boolean; updatedCount: number; models: string[] }> {
    return { success: true, updatedCount: 1, models: [this.cliTool] };
  }

  async generateResponse(
    modelName: string,
    systemInstruction: string,
    history: AIMessage[],
    tools?: AITool[]
  ): Promise<AIResponse> {
    let fullPrompt = systemInstruction ? `System: ${systemInstruction}\n\n` : '';
    for (const msg of history) {
      const role = msg.role === 'model' || msg.role === 'assistant' ? 'Assistant' : 'User';
      const text = msg.parts.map(p => p.text || '').join('\n');
      fullPrompt += `${role}: ${text}\n\n`;
    }

    if (tools && tools.length > 0) {
      fullPrompt += 'You have tools available: ' + tools.map(t => t.name).join(', ') + '. Respond with JSON to call.\n';
    }

    fullPrompt += 'Response:\n';

    return new Promise((resolve, reject) => {
      const MAX_OUTPUT_BUFFER_SIZE = 10 * 1024 * 1024;
      let args: string[] = [];
      if (this.providerId === 'kilo-cli') args = ['run', fullPrompt];
      else if (this.providerId === 'gemini-cli') args = ['--prompt', fullPrompt];
      else args = [fullPrompt];

      const cleanEnv = { ...process.env };
      delete cleanEnv.GEMINI_API_KEY;
      delete cleanEnv.OPENAI_API_KEY;
      delete cleanEnv.ANTHROPIC_API_KEY;

      const child = crossSpawn(this.cliTool, args, { windowsHide: true, env: cleanEnv as NodeJS.ProcessEnv });
      let output = '';
      let rejected = false;

      const handleData = (d: any) => {
        if (rejected) return;
        output += d.toString();
        if (output.length > MAX_OUTPUT_BUFFER_SIZE) {
          rejected = true;
          child.kill('SIGKILL');
          reject(new Error(`CLI output exceeded ${MAX_OUTPUT_BUFFER_SIZE / (1024 * 1024)} MB.`));
        }
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);
      
      child.on('close', (code: number | null) => {
        if (rejected) return;
        const text = output.trim();
        if (code !== 0 || text.includes('TerminalQuotaError') || (text.includes('Error') && text.includes('code: 429'))) {
          reject(new Error(`CLI exited with code ${code}. Output: ${text.substring(0, 200)}...`));
          return;
        }
        resolve({ text: text || 'No response.', toolCalls: [] });
      });
      child.on('error', (e: any) => {
        if (rejected) return;
        rejected = true;
        reject(new Error(`[CLI Error] ${e.message}`));
      });
    });
  }
}
