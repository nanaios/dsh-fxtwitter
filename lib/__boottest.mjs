/**
 * Boot test: exercise the plugin the way DSH's Cordis loader does.
 *
 * A fake context records `tools.register` and `effect`, then `apply` is called.
 * This catches the failure modes that would break DSH startup — a missing
 * export, a wrong inject name, a throwing body, a malformed definition.
 *
 *   node lib/__boottest.mjs
 */
import * as plugin from '../index.js';

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
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` :: ${JSON.stringify(detail).slice(0, 300)}`}`);
  }
}

console.log('=== plugin shape ===');
check(typeof plugin.apply === 'function', 'exports apply()');
check(typeof plugin.name === 'string' && plugin.name.length > 0, 'exports name', plugin.name);
check(Array.isArray(plugin.inject), 'exports inject array', plugin.inject);
check(plugin.inject.includes('tools'), 'injects the tools service', plugin.inject);

console.log('\n=== apply() against a mock context ===');
const registered = [];
const effects = [];
let toolDefinition;

const ctx = {
  tools: {
    register(definition) {
      toolDefinition = definition;
      registered.push(definition);
      return () => {};
    },
  },
  effect(factory, label) {
    effects.push(label);
    const disposer = factory();
    return typeof disposer === 'function' ? disposer : () => {};
  },
};

plugin.apply(ctx);

check(registered.length === 1, 'registers exactly one tool', registered.length);
check(effects.length === 1, 'wraps registration in ctx.effect', effects);
check(typeof toolDefinition?.name === 'string', 'tool has a name', toolDefinition?.name);
check(toolDefinition.name === 'fxtwitter', 'tool is named fxtwitter', toolDefinition.name);
check(typeof toolDefinition?.description === 'string' && toolDefinition.description.length > 50,
  'tool has a substantial description');
check(typeof toolDefinition?.execute === 'function', 'tool has execute()');
check(typeof toolDefinition?.output?.render === 'function', 'tool has output.render()');

console.log('\n=== parameter schema ===');
const params = toolDefinition?.parameters;
check(params?.type === 'object', 'parameters is an object schema');
check(Array.isArray(params?.required) && params.required.includes('action'), 'action is required');
const actionEnum = params?.properties?.action?.enum;
check(Array.isArray(actionEnum), 'action has an enum', actionEnum);
check(
  JSON.stringify(actionEnum) === JSON.stringify(['post', 'thread', 'user', 'search']),
  'action enum matches the implemented operations',
  actionEnum,
);
for (const key of ['target', 'query', 'count', 'cursor', 'replies']) {
  check(params?.properties?.[key] !== undefined, `declares "${key}" parameter`);
}

console.log('\n=== execute() end to end (live request) ===');
const value = await toolDefinition.execute(
  { action: 'post', target: 'https://x.com/NASA/status/2123169377855922254' },
  { signal: new AbortController().signal },
);
check(typeof value?.post?.text === 'string' && value.post.text.length > 20, 'execute returned a post');
check(value.post.author.screenName === 'NASA', 'execute resolved the author', value.post.author.screenName);

console.log('\n=== render() produces model-facing text ===');
const text = toolDefinition.output.render({ action: 'post' }, value);
check(typeof text === 'string' && text.includes('@NASA'), 'render produces readable text');
check(text.includes('likes'), 'render includes engagement counters');

console.log('\n=== error path: bad target ===');
let threw = null;
try {
  await toolDefinition.execute({ action: 'post', target: 'not-a-post' }, { signal: new AbortController().signal });
} catch (error) {
  threw = error;
}
check(threw !== null, 'a malformed target throws rather than returning junk');

console.log(`\n${failures === 0 ? 'BOOT TEST PASSED' : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
