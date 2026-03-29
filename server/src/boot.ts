/**
 * 🚀 Guardian Bootloader
 * 
 * This file is the new entry point for the server. It exists to decouple the 
 * Safe-Mode/Rollback mechanism (BootGuardian) from the main application's 
 * ES Module graph.
 * 
 * Why?
 * If `tsx watch` restarts the server due to a file change containing a 
 * Syntax Error, Node.js will fail during the static ESM Parse phase *before* 
 * any code is executed. By loading BootGuardian first, and then dynamically 
 * importing the main app, we ensure BootGuardian is active and can catch 
 * compilation/syntax errors to perform auto-rollback.
 */

import './bootGuardian.js';

// Dynamically import the main application
import('./index.js').catch((err) => {
  // If the import fails (e.g., due to a SyntaxError in the module graph),
  // the unhandledRejection/uncaughtException handlers from BootGuardian 
  // will catch it and trigger a rollback if an upgrade was in progress.
  
  // We throw it so the global handlers can process it
  throw err;
});
