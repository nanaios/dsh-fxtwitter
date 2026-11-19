/**
 * Host half of dsh-fxtwitter.
 *
 * Mounts the `fxtwitter` tool that lets an agent read X/Twitter posts,
 * threads, profiles and search results. Backed by the public fxtwitter API:
 * no login, no API key, no X account.
 *
 * @module @nanaios/dsh-fxtwitter
 */
import { registerTool } from './lib/tool.js';

export const name = 'dsh-fxtwitter';
// The tool only makes sense where there is a tool registry to register into.
// There is no working-directory dependency: this plugin touches no files.
export const inject = ['tools'];

/**
 * Mount the tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @returns {void}
 */
export function apply(ctx) {
  ctx.effect(() => registerTool(ctx), 'dsh-fxtwitter.tool');
}
