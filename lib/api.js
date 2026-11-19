/**
 * Thin client for the fxtwitter API.
 *
 * fxtwitter (https://github.com/FxEmbed/FxEmbed) is a public mirror of X/Twitter
 * post data built for Discord embeds. Its HTTP API needs **no login, no API key,
 * and no X account**, and — unlike x.com itself — it does not return 402/403 to
 * autonomous clients. That is what makes it usable from an agent tool.
 *
 * Two API generations are in use and both are live:
 *   - v1: `/user/status/:id`, `/user`            -> `{code, message, tweet|user}`
 *   - v2: `/2/status/:id`, `/2/thread/:id`,      -> `{code, results|status, cursor}`
 *         `/2/conversation/:id`,
 *         `/2/profile/:user/statuses`,
 *         `/2/search?q=`
 * The v2 surface is the interesting one: it exposes thread, conversation and
 * full search, none of which a logged-out x.com page will give you.
 *
 * @module @nanaios/dsh-fxtwitter/lib/api
 */

const BASE = 'https://api.fxtwitter.com';
const UA = 'dsh-fxtwitter/1.0 (+DeepSeek Harness plugin)';

/** Default per-request timeout. fxtwitter answers in <1s normally. */
const TIMEOUT_MS = 20_000;

/**
 * Error carrying the upstream HTTP status so the tool can report it precisely.
 */
export class FxError extends Error {
  /**
   * @param {string} message - human-readable failure.
   * @param {number} status - upstream HTTP status, 0 for transport failures.
   * @param {string} [detail] - upstream body excerpt.
   */
  constructor(message, status, detail) {
    super(message);
    this.name = 'FxError';
    this.status = status;
    this.detail = detail;
  }
}

/**
 * Cache of successful responses, keyed by path.
 *
 * fxtwitter's search endpoint rate-limits in a way that punishes repeated
 * identical calls (measured 2026-11-19: two `artemis` searches succeed, the
 * next two 404). Caching means a repeated read costs no request at all, which
 * is both faster and the main defence against tripping the limit.
 *
 * @type {Map<string, { at: number, body: any }>}
 */
const CACHE = new Map();

/** How long a cached response stays fresh. */
const CACHE_TTL_MS = 60_000;

/** Cap so a long session cannot grow the map without bound. */
const CACHE_MAX = 200;

/**
 * Paths are cacheable unless the caller opted out. Paged/search requests are
 * keyed by the full path including the query string, so they cache correctly.
 * @param {string} path - request path.
 * @returns {boolean} whether to cache.
 */
function isCacheable(path) {
  return path.length < 2048;
}

/**
 * Read a fresh cache entry.
 * @param {string} path - request path.
 * @returns {any|null} the cached body, or null when missing/stale.
 */
function cacheGet(path) {
  const entry = CACHE.get(path);
  if (entry === undefined) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    CACHE.delete(path);
    return null;
  }
  return entry.body;
}

/**
 * Store a successful response.
 * @param {string} path - request path.
 * @param {any} body - decoded body.
 * @returns {void}
 */
function cacheSet(path, body) {
  if (CACHE.size >= CACHE_MAX) {
    const oldest = CACHE.keys().next();
    if (!oldest.done) CACHE.delete(oldest.value);
  }
  CACHE.set(path, { at: Date.now(), body });
}

/**
 * GET a fxtwitter endpoint and decode JSON.
 *
 * Retry policy is deliberately narrow. A transport error or 5xx gets a short
 * backoff. A rate-limited search (404 with an empty `results` envelope) is
 * NOT retried in-place: measurements showed that retrying during the window
 * keeps it closed, so the caller gets a typed error carrying a retry hint
 * instead of the process silently stalling for a minute.
 *
 * @param {string} path - path beginning with `/`, may contain a query string.
 * @param {{ signal?: AbortSignal, retries?: number, cache?: boolean }} [options]
 *   cancellation, retry budget for transient failures, and cache control.
 * @returns {Promise<any>} the decoded JSON body.
 * @throws {FxError} on transport failure, non-2xx status, or undecodable body.
 */
export async function getJson(path, options = {}) {
  const { signal, retries = 2, cache = true } = options;

  if (cache && isCacheable(path)) {
    const hit = cacheGet(path);
    if (hit !== null) return hit;
  }

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new FxError('aborted', 0, '');

    // Compose the caller's cancellation with our own timeout.
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    const onAbort = () => timeout.abort();
    signal?.addEventListener('abort', onAbort, { once: true });

    let response;
    try {
      response = await fetch(`${BASE}${path}`, {
        signal: timeout.signal,
        headers: { accept: 'application/json', 'user-agent': UA },
      });
    } catch (error) {
      lastError = new FxError(
        timeout.signal.aborted ? 'request timed out' : `network error: ${error?.message ?? error}`,
        0,
      );
      if (attempt === retries) break;
      await sleep(backoffMs(attempt), signal);
      continue;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    const text = await response.text();

    if (response.ok) {
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new FxError('fxtwitter returned a non-JSON body', response.status, text.slice(0, 240));
      }
      // Do not cache an empty-result envelope: it is the same shape as the
      // rate-limit response, and caching it would pin a false "no results".
      const emptyResults = Array.isArray(body?.results) && body.results.length === 0;
      if (cache && isCacheable(path) && !emptyResults) cacheSet(path, body);
      return body;
    }

    // fxtwitter's v2 search answers 404 while rate limited, and the body is a
    // well-formed envelope with an empty `results` array - which is how a
    // rate-limited 404 is told apart from a genuine "no such post".
    //
    // Measured 2026-11-19: the window is short (seconds) but each request
    // against it appears to keep it closed. Two consecutive searches succeed,
    // the next two 404; polling every 2s took ~55s to clear, where going quiet
    // cleared it in ~20s. So: fail fast and tell the caller to back off.
    const rateLimited404 = response.status === 404 && text.includes('"results":[]');

    if (rateLimited404 || response.status === 429) {
      throw new FxError(
        'rate limited by fxtwitter — wait ~20s and retry (do not poll)',
        404,
        text.slice(0, 240),
      );
    }

    lastError = new FxError(
      response.status === 404
        ? 'not found'
        : `fxtwitter returned HTTP ${response.status}`,
      response.status,
      text.slice(0, 240),
    );

    const retryable = response.status >= 500;
    if (!retryable || attempt === retries) break;
    await sleep(backoffMs(attempt), signal);
  }

  throw lastError ?? new FxError('request failed', 0);
}

/**
 * Clear the response cache. Exposed for tests.
 * @returns {void}
 */
export function clearCache() {
  CACHE.clear();
}

/**
 * Delay before the next attempt for transient failures.
 * @param {number} attempt - zero-based attempt number that just failed.
 * @returns {number} milliseconds to wait.
 */
function backoffMs(attempt) {
  return 400 * 2 ** attempt;
}

/**
 * Sleep that wakes early on cancellation.
 * @param {number} ms - milliseconds to wait.
 * @param {AbortSignal} [signal] - cancellation signal.
 * @returns {Promise<void>} resolves after the delay or on abort.
 */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    }
    signal?.addEventListener('abort', finish, { once: true });
  });
}

/**
 * Accept a full status URL, a bare numeric id, or `user/status/<id>`.
 *
 * @param {string} raw - the caller-supplied reference.
 * @returns {{ user: string|null, id: string }} the parsed reference.
 * @throws {FxError} when no post id can be found.
 */
export function parseTarget(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') throw new FxError('no post reference given', 0);

  // Prefer an id that appears after /status/, so a URL like
  // https://x.com/user/status/20 is not derailed by digits elsewhere in the URL.
  const statusMatch = text.match(/\/status(?:es)?\/(\d{1,25})/);
  const idMatch = statusMatch ?? text.match(/^(\d{1,25})$/) ?? text.match(/(\d{5,25})/);
  if (idMatch === null) {
    throw new FxError(
      `could not find a post id in ${JSON.stringify(text)}; pass a status URL or the numeric id`,
      0,
    );
  }
  const id = idMatch[1];

  const userMatch = text.match(/(?:twitter\.com|x\.com|fxtwitter\.com|fixupx\.com)\/([A-Za-z0-9_]{1,15})\//);
  return { user: userMatch === null ? null : userMatch[1], id };
}

/**
 * Normalise a fxtwitter user record into the plugin's shape.
 *
 * Field names differ across the API generations and between endpoints, so each
 * read accepts the v1 and v2 spellings:
 *   followers/followers_count, statuses/tweets/statuses_count,
 *   verification.{verified,type} vs is_blue_verified/verified.
 *
 * @param {Record<string, any>} user - raw user object.
 * @returns {Record<string, any>} the normalised author.
 */
export function normaliseUser(user = {}) {
  const verification = user.verification ?? {};
  const verified = verification.verified ?? user.is_blue_verified ?? user.verified ?? null;
  const website = user.website;
  return {
    screenName: user.screen_name ?? user.username ?? null,
    name: user.name ?? null,
    id: user.id ?? null,
    followers: user.followers ?? user.followers_count ?? null,
    following: user.following ?? user.friends_count ?? null,
    posts: user.statuses ?? user.tweets ?? user.statuses_count ?? null,
    likes: user.likes ?? null,
    mediaCount: user.media_count ?? null,
    bio: user.description ?? null,
    location: user.location ?? null,
    website: website === null || website === undefined
      ? null
      : typeof website === 'string'
        ? website
        : website.url ?? website.display_url ?? null,
    joined: user.joined ?? user.created_at ?? null,
    verified: verified === true ? (verification.type ?? true) : verified,
    avatar: user.avatar_url ?? user.profile_image_url ?? null,
    banner: user.banner_url ?? user.profile_banner_url ?? null,
    protected: user.protected ?? null,
  };
}

/**
 * Normalise a fxtwitter post record into the plugin's shape.
 *
 * v1 nests media under `media.all`; v2 uses the same key. Both expose the
 * author as `author`. Engagement counters differ slightly in naming between
 * the two generations, so every read is defensive.
 *
 * @param {Record<string, any>} post - raw post object.
 * @returns {Record<string, any>} the normalised post.
 */
export function normalisePost(post = {}) {
  const media = Array.isArray(post.media?.all)
    ? post.media.all.map((item) => ({
      type: item.type ?? null,
      url: item.url ?? item.thumbnail_url ?? null,
      alt: item.altText ?? item.alt_text ?? null,
      width: item.width ?? null,
      height: item.height ?? null,
    }))
    : [];

  const quote = post.quote;
  return {
    id: post.id ?? null,
    url: post.url ?? null,
    text: post.text ?? '',
    lang: post.lang ?? null,
    createdAt: post.created_at ?? null,
    author: normaliseUser(post.author ?? {}),
    likes: post.likes ?? null,
    // fxtwitter v2 calls the retweet counter `reposts`; v1 uses `retweets`.
    retweets: post.reposts ?? post.retweets ?? null,
    replies: post.replies ?? null,
    quotes: post.quotes ?? null,
    views: post.views ?? null,
    bookmarks: post.bookmarks ?? null,
    isNoteTweet: post.is_note_tweet ?? null,
    repostedBy: post.reposted_by ?? null,
    media,
    poll: post.poll ?? null,
    replyingTo: post.replying_to ?? null,
    quote: quote === null || quote === undefined
      ? null
      : {
        id: quote.id ?? null,
        url: quote.url ?? null,
        text: quote.text ?? '',
        author: normaliseUser(quote.author ?? {}),
      },
  };
}
