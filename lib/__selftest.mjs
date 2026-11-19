/**
 * Live smoke test against the real fxtwitter API.
 *
 * Complements __offline_test.mjs: that one proves the parsing/rendering is
 * correct against captured fixtures, this one proves the upstream still answers
 * and still uses the field shapes we depend on.
 *
 * Search is the flaky part — fxtwitter rate-limits it aggressively (a burst of
 * identical searches starts returning 404-with-empty-results within seconds).
 * A rate-limited search is reported as SKIPPED, not FAILED, because it says
 * nothing about the code under test. Every other endpoint is reliable.
 *
 *   node lib/__selftest.mjs
 */
import { clearCache } from './api.js';
import { readPost, readThread, readUser, searchPosts } from './ops.js';
import { render } from './render.js';

const LIVE_ID = '2123169377855922254';
let failures = 0;
let skipped = 0;

/**
 * Assert a condition, recording a failure instead of throwing.
 * @param {boolean} condition - the assertion.
 * @param {string} label - what was checked.
 * @param {unknown} [detail] - extra context on failure.
 */
function check(condition, label, detail) {
  if (condition) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 200)}`}`);
  }
}

/**
 * Record an environment-dependent skip.
 * @param {string} label - what was skipped and why.
 */
function skip(label) {
  skipped += 1;
  console.log(`  SKIP ${label}`);
}

/**
 * Detect the rate-limit error fxtwitter raises for search.
 * @param {unknown} error - the caught value.
 * @returns {boolean} whether this is rate limiting rather than a real failure.
 */
function isRateLimited(error) {
  return error?.status === 404 && /rate limited/i.test(String(error?.message ?? ''));
}

// Cached responses would mask a real upstream change, so start cold.
clearCache();

console.log('=== post ===');
const post = await readPost(LIVE_ID);
check(typeof post.post.text === 'string' && post.post.text.length > 20, 'post has text');
check(post.post.author.screenName === 'NASA', 'post author resolved', post.post.author.screenName);
check(Number(post.post.likes) > 0, 'post has likes', post.post.likes);
check(Number(post.post.retweets) > 0, 'post has a retweet count', post.post.retweets);
check(Number(post.post.views) > 0, 'post has a view count', post.post.views);
console.log(`  text: ${post.post.text.slice(0, 60).replace(/\n/g, ' ')}…`);

console.log('\n=== thread ===');
const thread = await readThread(LIVE_ID, { count: 3 });
check(thread.post.id === LIVE_ID, 'thread root is the focal post');
check(Array.isArray(thread.replies), 'thread replies is an array');
console.log(`  replies: ${thread.replies.length}`);

console.log('\n=== user ===');
const user = await readUser('@NASA', { count: 3 });
check(user.user.screenName === 'NASA', 'handle resolved', user.user.screenName);
check(user.posts.length > 0, 'user has posts', user.posts.length);
check(Number(user.user.posts) > 0, 'profile post count populated', user.user.posts);
check(Number(user.user.followers) > 0, 'profile followers populated', user.user.followers);
console.log(`  followers: ${user.user.followers}  total posts: ${user.user.posts}`);

console.log('\n=== search ===');
try {
  const search = await searchPosts('artemis', { count: 3 });
  check(search.posts.length > 0, 'search returned posts', search.posts.length);
  console.log(`  results: ${search.posts.length}  cursor: ${search.cursor === null ? 'none' : 'yes'}`);
  const rendered = render({ action: 'search' }, search);
  check(rendered.includes('Search'), 'search renders a header');
} catch (error) {
  if (isRateLimited(error)) {
    skip('search — fxtwitter rate limited this request; retry the suite later');
  } else {
    check(false, 'search threw an unexpected error', error?.message);
  }
}

console.log(`\n${failures === 0 ? 'LIVE TESTS PASSED' : `${failures} CHECK(S) FAILED`}${skipped > 0 ? ` (${skipped} skipped)` : ''}`);
process.exit(failures === 0 ? 0 : 1);
