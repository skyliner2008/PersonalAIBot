# Codex Project Memory (PersonalAIBot)

Last updated: 2026-03-30 (Asia/Bangkok)  
Workspace: `C:\Users\MSI\PersonalAIBot`

## 1) System Snapshot

This repository is a unified AI agent platform with:

- Main backend: `server/` (TypeScript, Express, Socket.IO, SQLite)
- Main dashboard: `dashboard/` (React 19, Vite, Tailwind)
- Browser automation extension: `fb-extension/` (Messenger assistant)
- Legacy stack: `personal_ai/` (older standalone bot implementation)

Current production runtime center is `server/src/index.ts`, bootstrapped by `server/src/boot.ts` and `server/src/bootGuardian.ts`.

## 2) Startup and Runtime Flow

Observed startup sequence:

1. `boot.ts` imports `bootGuardian.ts`, then dynamically imports `index.ts`
2. `index.ts` configures Express + HTTP + Socket.IO
3. Security and observability middleware are installed
4. `initDb()` and additional table setup are executed
5. `initUnifiedMemory()` runs
6. Provider registry/factory initialization runs with health checker
7. `/api/auth/socket-token` endpoint is mounted
8. `registerHttpSurface()` mounts API/webhook/static dashboard
9. Socket auth and handlers are attached
10. Terminal gateway is initialized
11. Bots start, swarm coordinator initializes, agent bridge is wired
12. Optional loops start (`self-upgrade`, `subconscious`, `idle loop`)
13. HTTP server listens on `config.port` (default `3000`)

## 3) Main Interfaces

- HTTP surface: `server/src/api/httpSurface.ts`
- Main API router: `server/src/api/routes.ts`
- Health endpoints: `healthRoutes` + `/health`
- Dashboard socket client: `dashboard/src/hooks/useSocket.ts`
- Dashboard API client: `dashboard/src/services/api.ts`

## 4) Auth and Security Model

- JWT auth implementation: `server/src/utils/auth.ts`
- Login API route: `server/src/api/routes/authRoutes.ts`
- Read/write policy:
  - Read-only methods allow viewer/admin
  - Mutating methods require admin
- Socket token endpoint enforces access checks and rate limits
- Input sanitization and layered rate limits are configured in `index.ts`

## 5) Memory Architecture (Active Path)

Core file: `server/src/memory/unifiedMemory.ts`

Operational memory layers in code:

- Core memory: table `core_memory`
- Working memory: in-memory RAM cache with LRU/TTL behavior
- Recall memory: tables `messages` and `episodes`
- Archival semantic memory: `archival_memory` + vector store
- Graph context: `graphMemory.ts`

## 6) Swarm / Multi-Agent Layer

Core files:

- `server/src/swarm/swarmCoordinator.ts`
- `server/src/swarm/jarvisPlanner.ts`
- `server/src/swarm/specialistDispatcher.ts`
- `server/src/swarm/swarmBatchManager.ts`

Key behavior:

- Task queue with dependency handling and retries
- Specialist dispatch (including CLI specialists)
- Batch orchestration with progress and dashboard event broadcasting

## 7) Database Facts

Schema file: `server/src/database/schema.sql`  
Migration and runtime DB logic: `server/src/database/db.ts`

Important tables:

- Conversation/chat: `conversations`, `messages`, `episodes`
- Memory: `core_memory`, `archival_memory`, `knowledge`, `user_profiles`
- Config/credentials: `settings`, `api_keys` (plus encrypted credential flow in `db.ts`)
- Evolution/second brain: `upgrade_proposals`, `evolution_log`, `learning_journal`, `codebase_map`, `codebase_edges`, `codebase_embeddings`, `codebase_calls`
- Automation: `cron_jobs`, `scheduled_posts`

## 8) Dashboard Map

Entry points:

- `dashboard/src/App.tsx`
- `dashboard/src/services/api.ts`
- `dashboard/src/hooks/useSocket.ts`

Important pages:

- `AgentManager`, `MultiAgent`, `ToolManager`, `CronManager`
- `SystemHealth`, `TaskQueueMonitor`, `SelfUpgrade`, `BrainVisualizer`
- `JarvisCall`, `MemoryViewer`, `Settings`

Routing style is mostly state-based in `App.tsx` (not a full route-driven SPA design).

## 9) Facebook Extension

Core files:

- `fb-extension/src/background.js` (server API bridge, token tracking, circuit breaker)
- `fb-extension/src/messenger-content.js` (scan/process/standby state machine)

## 10) Legacy Subproject (`personal_ai/`)

Legacy implementation with its own:

- entrypoint (`personal_ai/src/index.ts`)
- agent (`personal_ai/src/agent.ts`)
- memory, tools, providers

Use it mainly as historical reference; main architecture is `server/` + `dashboard/`.

## 11) Practical Guardrails for Future Changes

- Do not change `boot.ts` / `bootGuardian.ts` without restart/failure-path verification.
- Keep DB migration compatibility in mind when editing `db.ts`.
- Preserve middleware and route mount order in `index.ts`.
- Auth changes usually require coordinated updates in both backend and dashboard (`JWT` + socket token flow).
- Existing docs under `docs/` are useful but must be validated against current source code.
