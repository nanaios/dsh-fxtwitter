/**
 * The `fxtwitter` agent tool.
 *
 * Registers one model-facing tool that reads X/Twitter through the public
 * fxtwitter API. Registering is enough for visibility: the registry feeds the
 * declarative parameters into the system prompt automatically.
 *
 * @module @nanaios/dsh-fxtwitter/lib/tool
 */
import { run } from './ops.js';
import { render } from './render.js';

const ACTIONS = ['post', 'thread', 'user', 'search'];

const DESCRIPTION = [
  'Read X (Twitter) posts, threads, user profiles and search results through the public fxtwitter API.',
  'No login, no API key and no X account are needed, and the upstream endpoint is not blocked for autonomous clients.',
  'Use action "post" to read one post (pass a status URL like https://x.com/user/status/123 or just the numeric id),',
  '"thread" to read a post together with its replies,',
  '"user" to read a profile and its recent posts (handle like NASA or @NASA),',
  'and "search" to find posts; search accepts the normal X operators: from:, to:, #tag, $cashtag, lang:, since:, until:, filter:media and "exact phrase".',
  'X\'s own search page requires a login, so "search" here is the only way to search as an agent.',
].join(' ');

/**
 * Register the fxtwitter tool.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the plugin context.
 * @returns {() => void} the disposer that unregisters the tool.
 */
export function registerTool(ctx) {
  return ctx.tools.register({
    name: 'fxtwitter',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ACTIONS,
          description: `The operation: ${ACTIONS.join(', ')}.`,
        },
        target: {
          type: 'string',
          description:
            'For "post" and "thread": a status URL or numeric post id. For "user": an X handle, with or without a leading @. For "search": the query (or use "query").',
        },
        query: {
          type: 'string',
          description: 'For action "search": the search expression. Takes precedence over "target".',
        },
        count: {
          type: 'integer',
          description:
            'Maximum number of posts to return for "thread", "user" and "search". Defaults to 20, capped at 100.',
        },
        cursor: {
          type: 'string',
          description:
            'For action "search": the cursor returned by a previous call, to fetch the next page.',
        },
        replies: {
          type: 'boolean',
          description:
            'For action "thread": whether to include replies. Defaults to true.',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: [],
        properties: {
          post: { type: 'object' },
          replies: { type: 'array' },
          user: { type: 'object' },
          posts: { type: 'array' },
          query: { type: 'string' },
          cursor: { type: 'string' },
        },
      },
      render,
    },
    async execute(args, exec) {
      const signal = exec?.signal;
      return run(args.action, args, { signal });
    },
    presentCall(args) {
      const subject = args.action === 'search' ? (args.query ?? args.target) : args.target;
      return {
        card: 'generic',
        title: `fxtwitter: ${args.action}${subject ? ` ${subject}` : ''}`,
        kind: 'other',
        rawInput: args,
      };
    },
  });
}
