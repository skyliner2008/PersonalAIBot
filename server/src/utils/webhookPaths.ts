/**
 * Centralized webhook path matcher for raw-body routes.
 * LINE signature verification requires exact raw request payload bytes.
 */
const exactMatchPaths = new Set(['/webhook', '/webhook/line']);
export function requiresRawWebhookBody(requestPath: string): boolean {
  if (!requestPath) return false;
  return exactMatchPaths.has(requestPath) || requestPath.startsWith('/webhook/line/');
}
