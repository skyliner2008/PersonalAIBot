import { isRunning } from '../automation/browser.js';
import { isChatMonitorActive } from '../automation/chatBot.js';
import { isCommentMonitorActive } from '../automation/commentBot.js';
import { FACEBOOK_AUTOMATION_PLUGIN_ID } from './agentTopology.js';

export type PluginRuntimeStatus = 'active' | 'degraded' | 'offline';

export interface PluginRuntimeSnapshot {
  id: string;
  name: string;
  type: 'automation-plugin';
  status: PluginRuntimeStatus;
  details: Record<string, unknown>;
}

export function getPluginRuntimeSnapshots(): PluginRuntimeSnapshot[] {
  let browserRunning = false;
  let chatMonitorActive = false;
  let commentMonitorActive = false;

  try {
    browserRunning = isRunning();
  } catch (error) {
    // Default to false to prevent crash
  }

  try {
    chatMonitorActive = isChatMonitorActive();
  } catch (error) {
    // Default to false to prevent crash
  }

  try {
    commentMonitorActive = isCommentMonitorActive();
  } catch (error) {
    // Default to false to prevent crash
  }

  const monitorCount = (chatMonitorActive ? 1 : 0) + (commentMonitorActive ? 1 : 0);

  let status: PluginRuntimeStatus = 'offline';
  if (browserRunning && monitorCount > 0) {
    status = 'active';
  } else if (browserRunning || monitorCount > 0) {
    status = 'degraded';
  }

  return [
    {
      id: FACEBOOK_AUTOMATION_PLUGIN_ID,
      name: 'Facebook Automation Extension',
      type: 'automation-plugin',
      status,
      details: {
        browserRunning,
        chatMonitorActive,
        commentMonitorActive,
      },
    },
  ];
}
