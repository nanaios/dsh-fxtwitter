/**
 * Capture live API responses as fixtures so the test suite can run offline.
 *
 * The search endpoint rate-limits aggressively (~20s silent cooldown), so a
 * test suite that hits the network on every run is inherently flaky. Fixtures
 * make the parsing and rendering assertions deterministic; a separate live
 * smoke test checks the upstream when it is reachable.
 *
 *   node lib/__capture_fixtures.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, 'fixtures');
const BASE = 'https://api.fxtwitter.com';
const HEADERS = { accept: 'application/json', 'user-agent': 'fixture-capture' };

const LIVE_ID = '2123169377855922254';

/** Endpoints to capture, keyed by fixture file name. */
const TARGETS = {
  'post-v1.json': `/NASA/status/${LIVE_ID}`,
  'post-v2.json': `/2/status/${LIVE_ID}`,
  'conversation.json': `/2/conversation/${LIVE_ID}`,
  'profile.json': '/2/profile/NASA',
  'profile-statuses.json': '/2/profile/NASA/statuses',
  'search.json': '/2/search?q=from%3ANASA',
};

await mkdir(OUT, { recursive: true });

/** @param {number} ms - delay. */
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const results = [];
for (const [name, path] of Object.entries(TARGETS)) {
  let saved = false;
  // A rate-limited search 404 is worth retrying after a silent pause; other
  // endpoints are cheap and reliable.
  for (let attempt = 0; attempt < 3 && !saved; attempt += 1) {
    try {
      const response = await fetch(`${BASE}${path}`, { headers: HEADERS });
      const text = await response.text();
      if (response.ok && text.trim().length > 2) {
        // Re-serialise with indentation so diffs stay readable in review.
        const pretty = JSON.stringify(JSON.parse(text), null, 2);
        await writeFile(join(OUT, name), `${pretty}\n`, 'utf8');
        results.push([name, `ok (${pretty.length} bytes)`]);
        saved = true;
        break;
      }
      results.push([name, `status ${response.status}, retrying`]);
    } catch (error) {
      results.push([name, `error ${error?.message ?? error}, retrying`]);
    }
    await wait(20_000);
  }
  if (!saved) results.push([name, 'FAILED to capture']);
}

console.log('=== fixture capture ===');
for (const [name, outcome] of results) {
  console.log(`  ${name.padEnd(24)} ${outcome}`);
}
