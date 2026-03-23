import express from 'express';
import { dbAll, dbRun, dbGet } from '../database/db.js';
import { v4 as uuidv4 } from 'uuid';

const router = express.Router();

// GET all cron jobs
router.get('/', async (req, res) => {
  try {
    const jobs = await dbAll('SELECT * FROM cron_jobs ORDER BY created_at DESC');
    res.json(jobs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// POST a new cron job
router.post('/', async (req, res) => {
  const { name, cron_expression, prompt, bot_id, chat_id, platform, is_active } = req.body;
  
  if (!name || !cron_expression || !prompt || !bot_id || !chat_id || !platform) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const id = uuidv4();
  const activeInt = is_active ? 1 : 0;

  try {
    await dbRun(`
      INSERT INTO cron_jobs (id, name, cron_expression, prompt, bot_id, chat_id, platform, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, name, cron_expression, prompt, bot_id, chat_id, platform, activeInt]);

    res.status(201).json({ id, message: 'Cron job created successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// PUT (update) an existing cron job
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, cron_expression, prompt, bot_id, chat_id, platform, is_active } = req.body;

  if (!name || !cron_expression || !prompt || !bot_id || !chat_id || !platform) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const activeInt = is_active ? 1 : 0;

  try {
    const existing = await dbGet('SELECT id FROM cron_jobs WHERE id=?', [id]);
    if (!existing) return res.status(404).json({ error: 'Cron job not found' });

    await dbRun(`
      UPDATE cron_jobs 
      SET name=?, cron_expression=?, prompt=?, bot_id=?, chat_id=?, platform=?, is_active=?, updated_at=CURRENT_TIMESTAMP
      WHERE id=?
    `, [name, cron_expression, prompt, bot_id, chat_id, platform, activeInt, id]);

    res.json({ message: 'Cron job updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE a cron job
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await dbGet('SELECT id FROM cron_jobs WHERE id=?', [id]);
    if (!existing) return res.status(404).json({ error: 'Cron job not found' });

    await dbRun('DELETE FROM cron_jobs WHERE id = ?', [id]);
    res.json({ message: 'Cron job deleted successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// TOGGLE active state
router.post('/:id/toggle', async (req, res) => {
  const { id } = req.params;
  try {
    const job: any = await dbGet('SELECT is_active FROM cron_jobs WHERE id = ?', [id]);
    if (!job) return res.status(404).json({ error: 'Cron job not found' });
    
    const newState = job.is_active ? 0 : 1;
    await dbRun('UPDATE cron_jobs SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newState, id]);
    
    res.json({ is_active: !!newState });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
