import fs from 'fs';
import path from 'path';
import sqlite3 from 'better-sqlite3';

const UPTIME_THRESHOLD_MS = 15000; // 15 seconds
const RECENT_UPGRADE_THRESHOLD_MS = 60000; // 1 minute
const UPGRADE_LOCK_PATH = path.resolve(process.cwd(), '../data/upgrade_in_progress.lock');

function isUpgradeLockActive(): boolean {
  try {
    if (!fs.existsSync(UPGRADE_LOCK_PATH)) return false;
    const lock = JSON.parse(fs.readFileSync(UPGRADE_LOCK_PATH, 'utf-8'));
    if (Date.now() - lock.startedAt > 720000) return false; // Expired after 12 min
    return true;
  } catch { return false; }
}

export function initBootGuardian() {
  const handleFatalCrash = (error: Error) => {
    try {
      const errorMsg = error.message || String(error);
      const isSyntaxError = /Transform failed|SyntaxError|Unterminated string|Expected.*found/i.test(errorMsg);

      if (process.uptime() * 1000 > UPTIME_THRESHOLD_MS && !isSyntaxError) {
        // Crash happened after safe boot window, let it die normally
        console.error('Fatal error after boot window:', error);
        process.exit(1);
      }

      // If upgrade lock is active, this restart is likely caused by tsx watch
      // detecting a file change mid-upgrade — NOT a real crash. Don't rollback.
      // UNLESS it's a syntax error (which will keep crashing anyway).
      if (isUpgradeLockActive() && !isSyntaxError) {
        console.error('\n⚠️ [BootGuardian] Upgrade lock is active — this restart was likely triggered by file watcher during upgrade.');
        console.error('[BootGuardian] Skipping rollback. The upgrade process will handle success/failure.');
        process.exit(1);
      }

      console.error(`\n🚨 [BootGuardian] Fatal ${isSyntaxError ? 'Syntax Error' : 'crash'} detected during server startup!`);
      console.error(error);

      const historyDir = path.resolve(process.cwd(), '../data/upgrade_history');
      const latestUpgradeFile = path.join(historyDir, 'latest_upgrade.json');
      
      if (!fs.existsSync(latestUpgradeFile)) {
        console.error('[BootGuardian] No recent upgrade record found. Exiting.');
        process.exit(1);
      }

      const latestUpgradeContent = fs.readFileSync(latestUpgradeFile, 'utf-8');
      const latestUpgrade = JSON.parse(latestUpgradeContent);

      const msSinceUpgrade = Date.now() - latestUpgrade.timestamp;
      if (msSinceUpgrade > RECENT_UPGRADE_THRESHOLD_MS) {
        console.error('[BootGuardian] Latest upgrade was too long ago. Exiting.');
        process.exit(1);
      }

      console.error(`[BootGuardian] Suspect Self-Upgrade: Proposal #${latestUpgrade.id} (${latestUpgrade.filePath})`);
      console.error(`[BootGuardian] Initiating Auto-Rollback...`);

      // Support multi-file rollback: check if allFiles manifest exists
      let rolledBackCount = 0;
      if (latestUpgrade.allFiles && Array.isArray(latestUpgrade.allFiles)) {
        for (let i = 0; i < latestUpgrade.allFiles.length; i++) {
          const backupName = `proposal_${latestUpgrade.id}_before${i > 0 ? `_dep${i}` : ''}.txt`;
          const backupFile = path.join(historyDir, backupName);
          const targetPath = latestUpgrade.allFiles[i].fullPath;
          if (fs.existsSync(backupFile) && targetPath) {
            try {
              const originalContent = fs.readFileSync(backupFile, 'utf-8');
              fs.writeFileSync(targetPath, originalContent, 'utf-8');
              rolledBackCount++;
            } catch (rbErr) {
              console.error(`[BootGuardian] Failed to rollback ${targetPath}: ${rbErr}`);
            }
          }
        }
      } else {
        // Legacy single-file rollback
        const backupFile = path.join(historyDir, `proposal_${latestUpgrade.id}_before.txt`);
        if (!fs.existsSync(backupFile)) {
          console.error(`[BootGuardian] Backup file not found at ${backupFile}. Cannot rollback!`);
          process.exit(1);
        }
        const originalContent = fs.readFileSync(backupFile, 'utf-8');
        fs.writeFileSync(latestUpgrade.filePath, originalContent, 'utf-8');
        rolledBackCount = 1;
      }
      console.error(`[BootGuardian] ✔️ ${rolledBackCount} file(s) restored.`);

      // Clean up upgrade lock if present
      try { if (fs.existsSync(UPGRADE_LOCK_PATH)) fs.unlinkSync(UPGRADE_LOCK_PATH); } catch {}

      // Update Database Status
      const dbPath = process.env.DB_PATH || path.resolve(process.cwd(), '../data/fb-agent.db');
      if (fs.existsSync(dbPath)) {
        const db = new sqlite3(dbPath);
        db.prepare(`UPDATE upgrade_proposals SET status = 'rejected', description = description || ? WHERE id = ?`)
          .run(`\n\nAuto-Rollback Triggered: Server crashed during boot with error: ${error.message}`, latestUpgrade.id);
        // Force WAL checkpoint so the status update persists across rapid restart cycles
        try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* best effort */ }
        db.close();
        console.error(`[BootGuardian] ✔️ Database status updated to Rejected.`);
      }

      // Delete the latest_upgrade file so we don't rollback endlessly
      fs.unlinkSync(latestUpgradeFile);

      console.error(`[BootGuardian] Rollback complete. Nodemon will now restart the server cleanly.\n`);
      process.exit(1);
    } catch (guardianError) {
      console.error('[BootGuardian] Failed to execute auto-rollback:', guardianError);
      process.exit(1);
    }
  };

  process.on('uncaughtException', handleFatalCrash);
  process.on('unhandledRejection', (reason: any) => {
    handleFatalCrash(reason instanceof Error ? reason : new Error(String(reason)));
  });

  // If the server survives the critical boot window (15 seconds), clear the footprint
  setTimeout(() => {
    try {
      const historyDir = path.resolve(process.cwd(), '../data/upgrade_history');
      const latestUpgradeFile = path.join(historyDir, 'latest_upgrade.json');
      if (fs.existsSync(latestUpgradeFile)) {
        fs.unlinkSync(latestUpgradeFile);
        console.log('[BootGuardian] 🛡️ Server stabilized. Upgrade footprint cleared.');
      }
    } catch {}
  }, UPTIME_THRESHOLD_MS + 1000);
}

// Auto-init when imported
initBootGuardian();
