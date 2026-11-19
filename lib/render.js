/**
 * Rendering of fxtwitter results into text a model can read directly.
 *
 * The tool returns structured JSON as its canonical value, but the model sees
 * this rendered text. Posts are formatted compactly — author, timestamp,
 * engagement, text, media alt-text, quoted post — so a thread stays legible
 * without exploding the context window.
 *
 * @module @nanaios/dsh-fxtwitter/lib/render
 */

const RULE = '─'.repeat(60);

/**
 * Compact a potentially huge count for display (325384 -> "325.4K").
 * @param {unknown} value - the raw counter.
 * @returns {string} a display string, or "-" when absent.
 */
export function formatCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '-';
  if (number < 1000) return String(number);
  if (number < 1_000_000) return `${(number / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/**
 * Format one post as a block of text.
 *
 * @param {Record<string, any>} post - a normalised post.
 * @param {{ indent?: string, showAuthor?: boolean }} [options] - layout options.
 * @returns {string} the rendered post.
 */
export function formatPost(post, options = {}) {
  const indent = options.indent ?? '';
  const showAuthor = options.showAuthor !== false;
  const lines = [];

  if (showAuthor) {
    const author = post.author ?? {};
    const handle = author.screenName === null ? '(unknown)' : `@${author.screenName}`;
    const name = author.name === null ? '' : ` (${author.name})`;
    const verified = author.verified ? ' ✓' : '';
    lines.push(`${indent}${handle}${name}${verified}`);
  }

  if (post.createdAt) lines.push(`${indent}${post.createdAt}`);

  const counters = [
    `likes ${formatCount(post.likes)}`,
    `retweets ${formatCount(post.retweets)}`,
    `replies ${formatCount(post.replies)}`,
    `quotes ${formatCount(post.quotes)}`,
    `views ${formatCount(post.views)}`,
  ];
  lines.push(`${indent}${counters.join('  ')}`);

  if (post.url) lines.push(`${indent}${post.url}`);
  lines.push(`${indent}${RULE}`);

  for (const line of String(post.text ?? '').split('\n')) {
    lines.push(`${indent}${line}`);
  }

  if (Array.isArray(post.media) && post.media.length > 0) {
    lines.push(`${indent}[${post.media.length} media]`);
    for (const item of post.media) {
      lines.push(`${indent}  - ${item.type ?? 'media'}: ${item.url ?? '(no url)'}`);
      if (item.alt) lines.push(`${indent}    alt: ${item.alt}`);
    }
  }

  if (post.poll) {
    const choices = Array.isArray(post.poll.choices) ? post.poll.choices : [];
    if (choices.length > 0) {
      lines.push(`${indent}[poll] ${choices.map((c) => `${c.label}: ${formatCount(c.count)}`).join('  ')}`);
    }
  }

  if (post.quote) {
    lines.push(`${indent}[quoted post]`);
    lines.push(formatPost(post.quote, { indent: `${indent}    ` }));
  }

  return lines.join('\n');
}

/**
 * Render a profile header plus its recent posts.
 *
 * @param {Record<string, any>} user - a normalised user.
 * @param {Array<Record<string, any>>} posts - the user's posts.
 * @returns {string} the rendered profile.
 */
export function formatUser(user, posts) {
  const lines = [];
  const handle = user.screenName === null ? '(unknown)' : `@${user.screenName}`;
  const name = user.name === null ? '' : user.name;
  lines.push(`${name} ${handle}${user.verified ? ' ✓' : ''}`.trim());
  if (user.bio) lines.push(`bio: ${user.bio}`);
  const facts = [
    `followers ${formatCount(user.followers)}`,
    `following ${formatCount(user.following)}`,
    `posts ${formatCount(user.posts)}`,
  ];
  if (user.location) facts.push(`location ${user.location}`);
  if (user.joined) facts.push(`joined ${user.joined}`);
  lines.push(facts.join('  '));
  lines.push('');

  if (posts.length === 0) {
    lines.push('No recent posts returned.');
    return lines.join('\n');
  }
  lines.push(`${posts.length} recent post${posts.length === 1 ? '' : 's'}:`);
  for (const post of posts) {
    lines.push('');
    lines.push(formatPost(post));
  }
  return lines.join('\n');
}

/**
 * Render the canonical tool value for the model.
 *
 * @param {Record<string, any>} args - tool arguments.
 * @param {Record<string, any>} value - canonical result.
 * @returns {string} the text shown to the model.
 */
export function render(args, value) {
  const action = args.action;

  if (action === 'post') {
    return formatPost(value.post);
  }

  if (action === 'thread') {
    const parts = [formatPost(value.post)];
    if (value.replies.length === 0) {
      parts.push('', '(no replies returned)');
    } else {
      parts.push('', `── ${value.replies.length} repl${value.replies.length === 1 ? 'y' : 'ies'} ──`);
      for (const reply of value.replies) {
        parts.push('', formatPost(reply));
      }
    }
    return parts.join('\n');
  }

  if (action === 'user') {
    return formatUser(value.user, value.posts);
  }

  if (action === 'search') {
    if (value.posts.length === 0) {
      return `No posts matched ${JSON.stringify(value.query)}.`;
    }
    const parts = [`Search ${JSON.stringify(value.query)} — ${value.posts.length} result${value.posts.length === 1 ? '' : 's'}`, ''];
    for (const post of value.posts) {
      parts.push(formatPost(post), '');
    }
    if (value.cursor) {
      parts.push(`[more results available — pass cursor: ${JSON.stringify(value.cursor)}]`);
    }
    return parts.join('\n');
  }

  return JSON.stringify(value, null, 2);
}
