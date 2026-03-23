// ============================================================
// Tools API Router — /api/tools/*
// ============================================================

import { Router } from 'express';
import {
  getAllTools,
  getToolMeta,
  getToolsByCategory,
  getToolsByPlatform,
  searchTools,
  getToolCategories,
  getDefaultToolNames,
  type ToolCategory,
  type ToolPlatform,
} from '../bot_agents/registries/toolRegistry.js';
import { requireAuth } from '../utils/auth.js';

const router = Router();
router.use(requireAuth('viewer'));

/**
 * GET /api/tools
 * List all tools, with optional filtering by category, platform, or search query.
 * Query params: ?category=os&platform=telegram&q=search
 */
router.get('/', (_req, res) => {
  try {
    let tools = getAllTools(); // test

    const { category, platform, q } = _req.query;

    if (category && typeof category === 'string' && getToolCategories().map(cat => cat.category).includes(category as ToolCategory)) {
      tools = getToolsByCategory(category as ToolCategory);
    }

    if (platform && typeof platform === 'string') {
      const platformTools = getToolsByPlatform(platform as ToolPlatform);
      const platformNames = new Set(platformTools.filter(Boolean).map(t => t.name));
      tools = tools.filter(t => platformNames.has(t.name));
    }

    if (q) {
      const queryString = typeof q === 'string' ? q : Array.isArray(q) ? q.join(' ') : undefined;
      if (queryString) {
        const searchResults = searchTools(queryString);
        const searchNames = new Set(searchResults.filter(Boolean).map(t => t.name));
        tools = tools.filter(t => searchNames.has(t.name));
      }
    }

    // Strip declaration from response (it's large and not needed by frontend)
    const clean = tools
      .filter(Boolean) // Ensure all elements are non-null/non-undefined objects
      .map(({ declaration: _, ...rest }) => rest);
    res.json(clean);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tools/categories
 * List all tool categories with counts.
 */
router.get('/categories', (_req, res) => {
  try {
    res.json(getToolCategories());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tools/defaults
 * Get list of tool names enabled by default.
 */
router.get('/defaults', (_req, res) => {
  try {
    res.json(getDefaultToolNames());
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tools/:name
 * Get metadata for a specific tool.
 */
router.get('/:name', (req, res) => {
  try {
    const meta = getToolMeta(req.params.name);
    if (!meta) return res.status(404).json({ error: 'Tool not found' });
    const { declaration: _, ...rest } = meta ?? {};
    res.json(rest);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
