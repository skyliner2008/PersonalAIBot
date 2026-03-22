# Adaptive Routing Strategy

## Fallback Chain
When a requested model fails or is unavailable, the system will attempt to use these models in order:
1. gemini: gemini-2.5-flash
2. gemini: gemini-2.0-flash
3. minimax: abab6.5s-chat

## Agent Instruction
As an AI Agent, you can edit this file to add or remove fallback models as you discover new models or providers in your environment.
When doing so, maintain the format: `[index]. [provider]: [model_name]`
