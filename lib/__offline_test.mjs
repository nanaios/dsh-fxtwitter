/**
 * Offline test for parsing and rendering, driven by captured fixtures.
 *
 * Deterministic: no network, so it cannot flake on fxtwitter's rate limiting.
 * Regenerate fixtures with `node lib/__capture_fixtures.mjs`.
 *
 *   node lib/__offline_test.mjs
 */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalisePost, normaliseUser, parseTarget } from './api.js';
import { formatCount, formatPost, formatUser, render } from './render.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures');

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
 * Read and decode a captured fixture.
 * @param {string} name - file name under lib/fixtures.
 * @returns {Promise<any>} decoded JSON.
 */
async function fixture(name) {
  return JSON.parse(await readFile(join(FIXTURES, name), 'utf8'));
}

console.log('=== parseTarget ===');
check(parseTarget('https://x.com/NASA/status/2123169377855922254').id === '2123169377855922254', 'status URL');
check(parseTarget('2123169377855922254').id === '2123169377855922254', 'bare id');
check(parseTarget('https://x.com/NASA/status/2123169377855922254').user === 'NASA', 'handle from URL');
check(parseTarget('https://twitter.com/i/web/status/20').id === '20', 'i/web URL with a 2-digit id');
check(parseTarget('https://x.com/a/status/123?s=20&t=abc').id === '123', 'id from URL with query string');

console.log('\n=== normalisePost: v1 payload ===');
const v1 = await fixture('post-v1.json');
const postV1 = normalisePost(v1.tweet);
check(postV1.text.length > 20, 'v1 text parsed');
check(postV1.author.screenName === 'NASA', 'v1 author', postV1.author.screenName);
check(Number(postV1.likes) > 0, 'v1 likes', postV1.likes);
check(Number(postV1.retweets) > 0, 'v1 retweets (field `retweets`)', postV1.retweets);
check(Number(postV1.views) > 0, 'v1 views', postV1.views);
check(postV1.media.length > 0, 'v1 media', postV1.media.length);
check(postV1.author.verified !== null && postV1.author.verified !== false, 'v1 author verified', postV1.author.verified);
check(Number(postV1.author.followers) > 0, 'v1 author followers', postV1.author.followers);

console.log('\n=== normalisePost: v2 payload ===');
const v2 = await fixture('post-v2.json');
const postV2 = normalisePost(v2.status);
check(postV2.text.length > 20, 'v2 text parsed');
check(postV2.id === '2123169377855922254', 'v2 id', postV2.id);
check(postV2.author.screenName === 'NASA', 'v2 author', postV2.author.screenName);
// v2 spells the counter `reposts`; a regression here silently renders "retweets 0".
check(Number(postV2.retweets) > 0, 'v2 retweets (field `reposts`)', postV2.retweets);
check(Number(postV2.likes) > 0, 'v2 likes', postV2.likes);
check(Number(postV2.views) > 0, 'v2 views', postV2.views);
check(postV2.media.length > 0, 'v2 media', postV2.media.length);
check(
  postV2.media.some((m) => typeof m.alt === 'string' && m.alt.length > 10),
  'v2 media carries alt text',
  postV2.media.map((m) => m.alt),
);

console.log('\n=== normaliseUser: profile payload ===');
const profile = await fixture('profile.json');
const user = normaliseUser(profile.user);
check(user.screenName === 'NASA', 'profile handle', user.screenName);
// v2 spells the counter `statuses`; a regression renders "posts 0".
check(Number(user.posts) > 0, 'profile posts (field `statuses`)', user.posts);
check(Number(user.followers) > 0, 'profile followers', user.followers);
check(typeof user.bio === 'string' && user.bio.length > 0, 'profile bio', user.bio);
check(user.verified !== null && user.verified !== false, 'profile verified', user.verified);
check(user.website !== null, 'profile website flattened from object', user.website);

console.log('\n=== conversation payload ===');
const conversation = await fixture('conversation.json');
const root = normalisePost(conversation.status);
const replies = (conversation.replies ?? []).map(normalisePost);
check(root.id === '2123169377855922254', 'conversation root', root.id);
check(replies.length > 0, 'conversation has replies', replies.length);
check(
  replies.every((r) => typeof r.text === 'string'),
  'every reply has text',
);

console.log('\n=== profile timeline payload ===');
const timeline = await fixture('profile-statuses.json');
const timelinePosts = (timeline.results ?? []).map(normalisePost);
check(timelinePosts.length > 0, 'timeline has posts', timelinePosts.length);
check(
  timelinePosts.every((p) => typeof p.text === 'string' && p.author.screenName !== null),
  'every timeline post has text and author',
);

console.log('\n=== formatCount ===');
check(formatCount(999) === '999', 'below 1000 stays exact', formatCount(999));
check(formatCount(1500) === '1.5K', 'thousands abbreviated', formatCount(1500));
check(formatCount(2_000_000) === '2M', 'millions abbreviated, no trailing .0', formatCount(2_000_000));
check(formatCount(null) === '-', 'missing counter renders as dash', formatCount(null));

console.log('\n=== formatPost ===');
const renderedPost = formatPost(postV2);
check(renderedPost.includes('@NASA'), 'post render shows handle');
check(renderedPost.includes('retweets'), 'post render shows counters');
check(renderedPost.includes('alt:'), 'post render includes media alt text');
check(!renderedPost.includes('retweets 0'), 'post render does not show a zeroed retweet count');

console.log('\n=== formatUser ===');
const renderedUser = formatUser(user, timelinePosts.slice(0, 2));
check(renderedUser.includes('@NASA'), 'user render shows handle');
check(!renderedUser.includes('posts 0'), 'user render does not show zeroed post count');
check(renderedUser.includes('recent post'), 'user render lists posts');

console.log('\n=== render() dispatcher ===');
const postOut = render({ action: 'post' }, { post: postV2 });
check(postOut.includes('@NASA'), 'render(post)');
const threadOut = render({ action: 'thread' }, { post: root, replies: replies.slice(0, 2) });
check(threadOut.includes('repl'), 'render(thread) labels replies');
const userOut = render({ action: 'user' }, { user, posts: timelinePosts.slice(0, 1) });
check(userOut.includes('@NASA'), 'render(user)');
const searchOut = render({ action: 'search' }, { query: 'x', posts: [], cursor: null });
check(searchOut.includes('No posts matched'), 'render(search) handles the empty case');

console.log(`\n${failures === 0 ? 'OFFLINE TESTS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
