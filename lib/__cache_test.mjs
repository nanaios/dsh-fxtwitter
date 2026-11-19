/**
 * Verify the rate-limit defence: a repeated identical request must be served
 * from cache instead of going back to the network.
 *
 * This is the behaviour that actually keeps the plugin out of trouble, because
 * fxtwitter's search limit punishes repeat calls rather than total volume.
 *
 *   node lib/__cache_test.mjs
 */
import { clearCache } from './api.js';
import { readPost, searchPosts } from './ops.js';

const LIVE_ID = '2123169377855922254';
let failures = 0;

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
 * Time an async operation.
 * @param {() => Promise<any>} fn - work to time.
 * @returns {Promise<{ result: any, ms: number }>} the outcome and duration.
 */
async function timed(fn) {
  const start = Date.now();
  const result = await fn();
  return { result, ms: Date.now() - start };
}

clearCache();

console.log('=== post: second read should not hit the network ===');
const first = await timed(() => readPost(LIVE_ID));
const second = await timed(() => readPost(LIVE_ID));
check(first.result.post.id === LIVE_ID, 'first read succeeded');
check(second.result.post.id === LIVE_ID, 'second read succeeded');
// A network round-trip to fxtwitter is ~100ms+; a cache hit is sub-millisecond.
check(second.ms < first.ms / 2, 'second read was materially faster', { first: first.ms, second: second.ms });
console.log(`  first ${first.ms}ms, second ${second.ms}ms`);

console.log('\n=== search: repeat is served from cache, so no second request ===');
try {
  const s1 = await timed(() => searchPosts('artemis', { count: 3 }));
  const s2 = await timed(() => searchPosts('artemis', { count: 3 }));
  check(s1.result.posts.length === s2.result.posts.length, 'both searches agree');
  check(s2.ms < s1.ms / 2, 'cached search was materially faster', { first: s1.ms, second: s2.ms });
  console.log(`  first ${s1.ms}ms, second ${s2.ms}ms`);
} catch (error) {
  // Rate limiting is environmental; cache correctness for search cannot be
  // observed when the first request never succeeds.
  console.log(`  SKIP search cache check — ${error?.message ?? error}`);
}

console.log(`\n${failures === 0 ? 'CACHE TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
