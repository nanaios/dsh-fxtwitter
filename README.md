# dsh-fxtwitter

Read X/Twitter posts, threads, profiles and **search results** from inside
DeepSeek Harness — no login, no API key, no X account.

Registers one agent tool, `fxtwitter`, backed by the public
[fxtwitter](https://github.com/FxEmbed/FxEmbed) API.

## Why fxtwitter

X blocks AI crawlers by User-Agent (`402 Payment Required` for GPTBot,
`403` for ClaudeBot/CCBot/Googlebot) and its own search page requires a login.
fxtwitter is a public mirror built for Discord embeds: it needs no credentials
and returns `200` to autonomous clients. Its **v2** API additionally exposes
thread, conversation and full search, which a logged-out x.com page cannot give.

Measured on 2026-11-19:

| Endpoint | Result |
|---|---|
| `/NASA/status/<id>` (v1) | 200, full post JSON |
| `/2/status/<id>` | 200, 3.8 KB |
| `/2/conversation/<id>` | 200, 46 KB (replies included) |
| `/2/profile/<user>/statuses` | 200, 70 KB |
| `/2/search?q=from:NASA` | 200, 20 results + cursor |

## Actions

| action | target | returns |
|---|---|---|
| `post` | status URL or numeric id | one post |
| `thread` | status URL or numeric id | the post plus its replies |
| `user` | handle (`NASA` or `@NASA`) | profile + recent posts |
| `search` | search expression (or `query`) | matching posts + cursor |

`search` accepts the normal X operators: `from:`, `to:`, `#tag`, `$cashtag`,
`lang:`, `since:`, `until:`, `filter:media`, `"exact phrase"`.

## Examples

```
fxtwitter  action=post    target=https://x.com/NASA/status/2123169377855922254
fxtwitter  action=thread  target=https://x.com/NASA/status/2123169377855922254
fxtwitter  action=user    target=NASA
fxtwitter  action=search  target=from:NASA
fxtwitter  action=search  target=artemis lang:ja since:2026-11-01
```

## Quirks worth knowing

- **The v2 search endpoint returns HTTP 404 while rate limited**, not 429. A retry
  a few seconds later succeeds. `lib/api.js` retries automatically.
- **fxtwitter answers HTTP 200 with an HTML error page** for a nonexistent post
  on some paths. The plugin validates the decoded body, not just the status.
- Field names differ between API generations — v2 says `reposts` and `statuses`
  where v1 says `retweets` and `tweets`. `lib/api.js` accepts both.

## Layout

```
index.js            plugin entry — mounts the tool
lib/tool.js         tool definition (schema, execute, presentCall)
lib/ops.js          post / thread / user / search operations
lib/api.js          HTTP client, error type, payload normalisation
lib/render.js       model-facing text rendering
lib/__selftest.mjs  smoke test for the operation + render layers
lib/__boottest.mjs  boot test: apply() against a mock DSH context
```

## Test

```sh
node lib/__selftest.mjs   # live API calls, parsing, rendering
node lib/__boottest.mjs   # plugin loads: exports, inject, schema, execute, error path
```

Both run real requests against the live API and assert on parsed values,
including the retweet/view/post-count fields whose names differ between API
versions.

## Install

Clone this repository anywhere, then link it into a DSH profile:

```bash
git clone <this-repo> dsh-fxtwitter
cd dsh-fxtwitter
```

Edit `~/.dsh/profiles/<profile>/package.json`:

```jsonc
{
  "dependencies": {
    "@nanaios/dsh-fxtwitter": "link:/absolute/path/to/dsh-fxtwitter"
  },
  "dsh": {
    "profile": {
      "bundles": [
        // …existing bundles…
        "@nanaios/dsh-fxtwitter"
      ]
    }
  }
}
```

Create the package link the profile resolves through:

```bash
mkdir -p ~/.dsh/profiles/<profile>/node_modules/@nanaios
```

```powershell
# Windows
New-Item -ItemType Junction `
  -Path "$HOME\.dsh\profiles\<profile>\node_modules\@nanaios\dsh-fxtwitter" `
  -Target "$(Get-Location).Path"
```

```bash
# macOS / Linux
ln -s "$PWD" ~/.dsh/profiles/<profile>/node_modules/@nanaios/dsh-fxtwitter
```

Then **restart DeepSeek Harness**. Profile bundles are read at startup; the
`fxtwitter` tool appears in the agent's tool list after the restart.

`cordis.patch.yml` in this repository inserts the `fxtwitter` row; you do not
edit it. To uninstall, remove the two `package.json` lines, delete the link, and
restart.

## Caveats

- fxtwitter is a **third-party** service, not an X product. It can change or
  disappear without notice.
- X's Terms of Service prohibit scraping. This plugin reads public data through a
  third-party mirror; keep usage low-volume and non-commercial, and do not use it
  to build a competing product or a training corpus.
- For full-archive search, follower lists, or commercial use, use the official
  X API (pay-per-use: $0.005 per post read).
