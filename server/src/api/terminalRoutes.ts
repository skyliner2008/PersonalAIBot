/**
 * Terminal REST API Routes
 *
 * Provides REST endpoints for terminal operations:
 *   GET  /api/terminal/sessions            -> List active sessions
 *   GET  /api/terminal/backends[?refresh=1] -> List available backends
 *   GET  /api/terminal/help                -> Get plain-text help
 *   POST /api/terminal/execute             -> Execute a one-shot routed command
 */

import { Router, type Request, type Response } from 'express';
import { getSessionManager, executeCommand } from '../terminal/terminalGateway.js';
import { getAvailableBackends, getHelpText, refreshAvailableBackends } from '../terminal/commandRouter.js';
import { requireAuth } from '../utils/auth.js';

interface AuthenticatedRequest extends Request {
  user?: { username?: string };
}

const router = Router();
router.use(requireAuth('admin'));

/**
 * Helper to handle errors and avoid duplicated logic
 */
const handleError = (res: Response, err: any) => {
  if (res.headersSent) return;
  res.status(500).json({ error: err.message || String(err) });
};

/** List active terminal sessions */
router.get('/sessions', (_req: Request, res: Response) => {
  try {
    const mgr = getSessionManager();
    if (!mgr) {
      return res.json({ sessions: [], count: 0 });
    }

    const sessions = mgr.listSessions();
    res.json({ sessions, count: sessions.length });
  } catch (err: any) {
    handleError(res, err);
  }
});

/** List available backends (with optional refresh) */
router.get('/backends', async (req: Request, res: Response) => {
  try {
    const shouldRefresh = req.query.refresh === 'true' || req.query.refresh === '1' || String(req.query.refresh).toLowerCase() === 'yes';
    const backends = shouldRefresh ? await refreshAvailableBackends() : getAvailableBackends();
    res.json({ backends, refreshed: shouldRefresh });
  } catch (err: any) {
    handleError(res, err);
  }
});

/** Get help text */
router.get('/help', (_req: Request, res: Response) => {
  try {
    const help = getHelpText().replace(/\x1b\[[^m]*m/g, '');
    res.json({ help });
  } catch (err: any) {
    handleError(res, err);
  }
});

/** Execute a one-shot command and return output */
router.post('/execute', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { command, platform } = req.body as { command?: string; platform?: string };
    const user = req.user;

    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      return res.status(400).json({ error: 'A valid command string is required' });
    }

    // Sanitize input to mitigate command injection risks: remove null bytes and trim whitespace
    // and escape shell metacharacters to prevent unintended shell execution.
    const sanitizedCommand = command
      .replace(/\0/g, '')
      .replace(/([\\\\\\'"\\!&\\*\\(\\)\\|;<>\\?\\[\\]{}])/g, '\\\\$1')
      .trim();

    // Validate and sanitize platform: must be alphanumeric, underscore, or hyphen; otherwise, default to 'api'
    const sanitizedPlatform = (typeof platform === 'string' && /^[a-zA-Z0-9_-]+$/.test(platform)) ? platform.trim() : 'api';

    const result = await executeCommand(sanitizedCommand, sanitizedPlatform, user?.username);
    if (res.headersSent) return;
    res.json({ output: result, command: sanitizedCommand });
  } catch (err: any) {
    handleError(res, err);
  }
});

export default router;
