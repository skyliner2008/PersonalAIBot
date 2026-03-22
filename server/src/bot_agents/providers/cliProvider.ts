// @ts-ignore
import crossSpawn from 'cross-spawn';
import type { Content, FunctionDeclaration } from '@google/genai';
import type { AIProvider, AIResponse } from './baseProvider.js';

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

  async generateResponse(
    modelName: string,
    systemInstruction: string,
    contents: Content[],
    tools?: FunctionDeclaration[]
  ): Promise<AIResponse> {
    let fullPrompt = systemInstruction ? `System: ${systemInstruction}\n\n` : '';
    for (const msg of contents) {
        const role = msg.role === 'model' ? 'Assistant' : 'User';
        const text = msg.parts?.map(p => p.text).join('\n') || '';
        fullPrompt += `${role}: ${text}\n\n`;
    }

    if (tools && tools.length > 0) {
        fullPrompt += 'You have tools available: ' + tools.map(t => t.name).join(', ') + '. You can respond with JSON to call them.\n';
    }

    fullPrompt += 'Response:\n';

    return new Promise((resolve, reject) => {
      const MAX_OUTPUT_BUFFER_SIZE = 10 * 1024 * 1024; // 10 MB limit for CLI output
      let args: string[] = [];
      if (this.providerId === 'kilo-cli') args = ['run', fullPrompt];
      else if (this.providerId === 'gemini-cli') args = ['--prompt', fullPrompt];
      else args = [fullPrompt]; // Fallback for claude or openai if supported

      // Strip server API keys from the environment to force CLI tools to use their own local OAuth configs.
      const cleanEnv = { ...process.env };
      delete cleanEnv.GEMINI_API_KEY;
      delete cleanEnv.OPENAI_API_KEY;
      delete cleanEnv.ANTHROPIC_API_KEY;

      // Use cross-spawn to safely escape multiline CLI arguments across Windows/Linux without shell: true vulnerabilities.
      const child = crossSpawn(this.cliTool, args, { windowsHide: true, env: cleanEnv as NodeJS.ProcessEnv });
      let output = '';
      let rejected = false; // Flag to ensure promise is rejected only once

      const handleData = (d: any) => {
        if (rejected) return;
        output += d.toString();
        if (output.length > MAX_OUTPUT_BUFFER_SIZE) {
          rejected = true;
          child.kill('SIGKILL'); // Terminate the child process
          reject(new Error(`CLI output exceeded maximum buffer size of ${MAX_OUTPUT_BUFFER_SIZE / (1024 * 1024)} MB. Process killed.`));
        }
      };

      child.stdout.on('data', handleData);
      child.stderr.on('data', handleData);
      
      child.on('close', (code: number | null) => {
        if (rejected) return; // If already rejected by buffer overflow, do nothing
        const text = output.trim();
        if (code !== 0 || text.includes('TerminalQuotaError') || (text.includes('Error') && text.includes('code: 429'))) {
          reject(new Error(`CLI exited with code ${code}. Output: ${text.substring(0, 200)}...`));
          return;
        }
        resolve({ text: text || 'No response from CLI tool.', toolCalls: [] });
      });
      child.on('error', (e: any) => {
        if (rejected) return; // Prevent double rejection
        rejected = true;
        reject(new Error(`[CLI Error] Failed to run ${this.cliTool}: ${e.message}`));
      });
    });
  }
}
