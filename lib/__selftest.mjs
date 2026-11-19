/**
 * Standalone smoke test for the operation + render layers.
 * Runs the real API calls; needs no DSH context.
 *
 *   node lib/__selftest.mjs
 */
import { parseTarget } from './api.js';
import { readPost, readThread, readUser, searchPosts } from './ops.js';
import { render } from './render.js';

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

console.log('=== parseTarget ===');
check(parseTarget(`https://x.com/NASA/status/${LIVE_ID}`).id === LIVE_ID, 'parse status URL');
check(parseTarget(LIVE_ID).id === LIVE_ID, 'parse bare id');
check(parseTarget(`https://x.com/NASA/status/${LIVE_ID}`).user === 'NASA', 'parse handle from URL');
check(parseTarget('https://twitter.com/i/web/status/20').id === '20', 'parse /i/web/status URL');

console.log('\n=== post ===');
const post = await readPost(LIVE_ID);
check(typeof post.post.text === 'string' && post.post.text.length > 20, 'post has text');
check(post.post.author.screenName !== null, 'post has author', post.post.author);
// Field-name regressions: v2 spells these `reposts`/`statuses`, v1 `retweets`/`tweets`.
check(Number(post.post.retweets) > 0, 'post has a retweet count', post.post.retweets);
check(Number(post.post.likes) > 0, 'post has a like count', post.post.likes);
check(Number(post.post.views) > 0, 'post has a view count', post.post.views);
check(post.post.author.followers > 0, 'post author has followers', post.post.author.followers);
console.log(`  text: ${post.post.text.slice(0, 70).replace(/\n/g, ' ')}...`);
console.log(`  author: @${post.post.author.screenName}  likes: ${post.post.likes}  rt: ${post.post.retweets}`);

console.log('\n=== thread ===');
const thread = await readThread(LIVE_ID, { count: 3 });
check(thread.post.id === LIVE_ID, 'thread root is the focal post');
check(Array.isArray(thread.replies), 'thread replies is an array');
console.log(`  replies: ${thread.replies.length}`);

console.log('\n=== user ===');
const user = await readUser('@NASA', { count: 3 });
check(user.user.screenName === 'NASA', 'user handle resolved', user.user.screenName);
check(user.posts.length > 0, 'user has posts', user.posts.length);
// `statuses` is the v2 profile counter; `tweets` was the v1/Twitter term.
check(Number(user.user.posts) > 0, 'user has a post count', user.user.posts);
check(Number(user.user.followers) > 0, 'user has followers', user.user.followers);
check(user.user.verified !== null && user.user.verified !== false, 'user has verification info', user.user.verified);
console.log(`  followers: ${user.user.followers}  posts total: ${user.user.posts}  returned: ${user.posts.length}`);

console.log('\n=== search ===');
const search = await searchPosts('from:NASA', { count: 3 });
check(search.posts.length > 0, 'search returned posts', search.posts.length);
console.log(`  results: ${search.posts.length}  cursor: ${search.cursor === null ? 'none' : 'yes'}`);

console.log('\n=== render ===');
const renderedPost = render({ action: 'post' }, post);
check(renderedPost.includes(post.post.author.screenName ?? 'x'), 'render post mentions author');
check(renderedPost.includes('likes'), 'render post has counters');
const renderedSearch = render({ action: 'search' }, search);
check(renderedSearch.includes('Search'), 'render search has header');
check(renderedSearch.length > 100, 'render search is substantial');

console.log('\n--- sample render (post) ---');
console.log(renderedPost.slice(0, 600));
console.log('\n--- sample render (user) ---');
console.log(render({ action: 'user' }, user).slice(0, 500));

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
