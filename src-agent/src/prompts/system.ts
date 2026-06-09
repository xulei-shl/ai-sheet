/**
 * Dynamic system prompt builder.
 *
 * Static identity and meta-rules are now in .pi/AGENTS.md, injected via
 * DefaultResourceLoader.agentsFilesOverride (see agent.ts).
 *
 * Dynamic context (loaded files, sample data) is injected at runtime via
 * session.steer() in main.ts handleSteer().
 *
 * This module is reserved for future dynamic prompt augmentation if needed.
 */

export function buildSystemPrompt(_context?: unknown): string {
  return '';
}
