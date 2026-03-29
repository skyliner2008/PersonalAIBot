# PersonalAIBotV2 - AI Server

## Recent Updates (2026-03-29)
### Universal AI Provider Migration
- **Provider-Agnostic Core**: Moved away from direct `@google/genai` dependencies in major modules (`Agent`, `ToolRegistry`, `AIRouter`).
- **Standardized AITool Interface**: All 40+ tools now use the `AITool` schema, ensuring compatibility across Gemini, OpenAI, and other LLMs.
- **Enhanced Routing**: Updated `ai_routing_config.json` to leverage Gemini 2.5 and 3.0 models for improved reasoning and speed.
- **Resilient Streaming**: Refactored SSE streaming to handle multiple AI backends seamlessly.

### Safe-Upgrade 2.0 (2026-03-29)
- **Virtual Sandbox Integration**: Implemented an isolated environment (`data/upgrade_sandbox`) for AI-generated code validation. This prevents "Stealth Rollbacks" by ensuring all TSC and boot tests pass in a sandbox before production commit.
- **Audit & Integrity Tool**: Added `src/evolution/auditUpgrade.ts` to verify code consistency between Disk and Database. Detected and flagged 13 historical discrepancies for manual review.
- **Improved Security**: Enhanced `OpenAIEmbeddingProvider` to manage API keys in memory instead of persistent member variables.
- **Self-Healing Stability**: Corrected Enum validation logic in `selfHealing.ts` to prevent runtime type errors.
