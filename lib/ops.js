/**
 * The four read operations the tool exposes, expressed against fxtwitter.
 *
 * Each function returns plain JSON-ready data; the tool layer owns schema,
 * validation and rendering, so these stay testable without a DSH context.
 *
 * @module @nanaios/dsh-fxtwitter/lib/ops
 */
import { FxError, getJson, normalisePost, normaliseUser, parseTarget } from './api.js';

/** How many posts a single call may return, to keep results sane for a model. */
export const MAX_COUNT = 100;
export const DEFAULT_COUNT = 20;

/**
 * Clamp a caller-supplied count into the supported range.
 * @param {unknown} raw - requested count.
 * @param {number} [fallback] - value to use when absent.
 * @returns {number} a safe integer count.
 */
export function clampCount(raw, fallback = DEFAULT_COUNT) {
  const value = raw === undefined || raw === null ? fallback : Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(MAX_COUNT, Math.trunc(value)));
}

/**
 * Read one post.
 *
 * The v1 endpoint is preferred here because it carries the richest single-post
 * payload (poll, quote, bookmarks, source) and is the most widely mirrored.
 *
 * @param {string} ref - status URL or numeric id.
 * @param {{ signal?: AbortSignal }} [options] - cancellation.
 * @returns {Promise<Record<string, any>>} `{ post }`.
 */
export async function readPost(ref, options = {}) {
  const { user, id } = parseTarget(ref);
  const path = user === null ? `/2/status/${id}` : `/${user}/status/${id}`;

  const body = await getJson(path, { signal: options.signal });
  const raw = body?.tweet ?? body?.status;
  if (raw === undefined || raw === null) {
    throw new FxError('fxtwitter returned no post for that reference', 0, JSON.stringify(body).slice(0, 200));
  }
  return { post: normalisePost(raw) };
}

/**
 * Read a conversation around one post: the focal post plus its replies.
 *
 * @param {string} ref - status URL or numeric id.
 * @param {{ signal?: AbortSignal, count?: number, includeReplies?: boolean }} [options] - cancellation and shaping.
 * @returns {Promise<Record<string, any>>} `{ post, replies }`.
 */
export async function readThread(ref, options = {}) {
  const { id } = parseTarget(ref);
  const count = clampCount(options.count);
  const includeReplies = options.includeReplies !== false;

  const body = await getJson(`/2/conversation/${id}`, { signal: options.signal });
  const root = body?.status ?? body?.tweet;
  if (root === undefined || root === null) {
    throw new FxError('fxtwitter returned no conversation for that reference', 0, JSON.stringify(body).slice(0, 200));
  }

  // The conversation payload lists replies under `replies` (v2) and sometimes
  // under `thread`; accept either and de-duplicate by id.
  const seen = new Set();
  const replies = [];
  if (includeReplies) {
    for (const item of [...(body.replies ?? []), ...(body.thread ?? [])]) {
      const post = normalisePost(item);
      if (post.id === null || seen.has(post.id)) continue;
      seen.add(post.id);
      replies.push(post);
      if (replies.length >= count) break;
    }
  }

  return { post: normalisePost(root), replies };
}

/**
 * Read a user's profile and their recent posts.
 *
 * @param {string} handle - screen name, with or without a leading `@`.
 * @param {{ signal?: AbortSignal, count?: number }} [options] - cancellation and shaping.
 * @returns {Promise<Record<string, any>>} `{ user, posts }`.
 */
export async function readUser(handle, options = {}) {
  const screenName = String(handle ?? '').trim().replace(/^@+/, '');
  if (screenName === '') throw new FxError('no account handle given', 0);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(screenName)) {
    throw new FxError(`${JSON.stringify(screenName)} is not a valid X handle`, 0);
  }
  const count = clampCount(options.count);

  // Profile metadata and the timeline are separate endpoints; the timeline is
  // the one that most often 404s for sparse accounts, so fetch metadata first
  // and treat a missing timeline as an empty result rather than a failure.
  const [profileBody, timelineBody] = await Promise.all([
    getJson(`/2/profile/${screenName}`, { signal: options.signal }).catch(() => null),
    getJson(`/2/profile/${screenName}/statuses`, { signal: options.signal }).catch((error) => {
      if (error instanceof FxError && error.status === 404) return null;
      throw error;
    }),
  ]);

  const rawUser = profileBody?.user ?? profileBody?.results?.[0]?.author ?? timelineBody?.results?.[0]?.author ?? null;
  const posts = Array.isArray(timelineBody?.results)
    ? timelineBody.results.map(normalisePost).slice(0, count)
    : [];

  if (rawUser === null && posts.length === 0) {
    throw new FxError(`no data for @${screenName}; the account may not exist or may be protected`, 0);
  }

  return {
    user: rawUser === null ? normaliseUser(posts[0]?.author ?? {}) : normaliseUser(rawUser),
    posts,
  };
}

/**
 * Search X.
 *
 * This is the capability a logged-out x.com cannot provide at all: `/search`
 * there redirects to a login wall. fxtwitter's v2 search returns real results
 * and honours the usual operators (`from:`, `to:`, `#tag`, `$cashtag`,
 * `lang:`, `since:`, `until:`, `filter:media`, `"exact phrase"`).
 *
 * @param {string} query - the search expression.
 * @param {{ signal?: AbortSignal, count?: number, cursor?: string }} [options] - cancellation, shaping and paging.
 * @returns {Promise<Record<string, any>>} `{ query, posts, cursor }`.
 */
export async function searchPosts(query, options = {}) {
  const text = String(query ?? '').trim();
  if (text === '') throw new FxError('no search query given', 0);
  const count = clampCount(options.count);

  const params = new URLSearchParams({ q: text });
  if (options.cursor !== undefined && options.cursor !== null && String(options.cursor) !== '') {
    params.set('cursor', String(options.cursor));
  }

  const body = await getJson(`/2/search?${params.toString()}`, { signal: options.signal });
  const results = Array.isArray(body?.results) ? body.results : [];
  return {
    query: text,
    posts: results.map(normalisePost).slice(0, count),
    cursor: body?.cursor?.bottom ?? body?.cursor?.top ?? null,
  };
}

/**
 * Dispatch an operation by name.
 *
 * @param {string} action - one of post, thread, user, search.
 * @param {Record<string, any>} args - validated tool arguments.
 * @param {{ signal?: AbortSignal }} [options] - cancellation.
 * @returns {Promise<Record<string, any>>} the operation result.
 */
export async function run(action, args, options = {}) {
  const shared = { signal: options.signal, count: args.count };
  switch (action) {
    case 'post':
      return readPost(args.target, shared);
    case 'thread':
      return readThread(args.target, { ...shared, includeReplies: args.replies !== false });
    case 'user':
      return readUser(args.target, shared);
    case 'search':
      return searchPosts(args.query ?? args.target, { ...shared, cursor: args.cursor });
    default:
      throw new FxError(`unknown action ${JSON.stringify(action)}`, 0);
  }
}
