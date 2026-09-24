# AgentIndex

**A `robots.txt` for AI agents.**

AgentIndex is an open, proposed convention plus real tooling for websites to
tell AI agents — chat assistants that browse, autonomous crawlers, RAG
indexers, research bots — exactly which parts of a site they may access, how
fast, and under what terms. It is `robots.txt`, but with the vocabulary
`robots.txt` never had: *agent* (not just "search crawler"), rate limits, and
attribution requirements, expressed in a small YAML file any tool can parse.

## Why

`robots.txt` was designed in 1994 for search-engine crawlers indexing pages
for a search result. It has exactly two verbs (`Allow`/`Disallow`) and no
concept of:

- an "AI agent" as distinct from a search crawler,
- a requested request rate ("please, no more than N requests/minute"),
- attribution terms ("you may use this content, but you must credit us"),
- a machine-readable contact point for policy questions.

AI agents today read, summarize, and republish web content at a much
larger scale and for different purposes than search indexing. Site owners
increasingly want to say yes to some of that (crawl our docs, please) and no
to other parts of it (don't scrape our forum's user profiles), with
conditions attached — and there's no standard, finer-grained-than-`robots.txt`
way to say that. AgentIndex is a concrete proposal for what that file could
look like, plus a working parser/validator and permission-check library so
it's usable today, not just theoretical.

## The spec

> Status: **draft v1**, un-ratified. This is a proposal, not a standard body's
> ratified document. See [Limitations](#limitations).

### Where to publish it

A site publishes its policy as a YAML file at:

```
https://example.com/.well-known/agent-index.yaml
```

This follows [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615) "well-known
URI" conventions (the same family `/.well-known/security.txt` belongs to).
Sites may additionally (or instead) publish a copy at
`https://example.com/agent-index.yaml` for discoverability, but the
well-known path is the canonical location AgentIndex-aware tools should
check first, and the only path this project's `fetch` command checks.

### File structure

```yaml
version: 1                            # required, integer, currently must be 1
default: disallow                     # required, "allow" | "disallow"
contact: "mailto:agents@example.com"  # optional, site-wide contact
rules:                                 # required, list (may be empty: [])
  - pattern: "/docs/**"
    allow: true
    rate_limit: 60
    require_attribution: true

  - pattern: "/docs/internal/**"
    allow: false

  - pattern: "/blog/**"
    allow: true
    rate_limit: 30

  - pattern: "/api/*.json"
    allow: true
    rate_limit: 120
    contact: "mailto:api-team@example.com"
```

### Top-level fields

| Field     | Type                    | Required | Description |
|-----------|--------------------------|----------|--------------|
| `version` | integer                  | yes      | Spec version. Only `1` is defined right now. Parsers must reject unknown versions rather than guess. |
| `default` | `"allow"` \| `"disallow"` | yes | The fallback verdict for any path that no rule in `rules` matches. |
| `contact` | string                   | no       | Site-wide contact for questions about this policy: a `mailto:` URI, an `https://` URL, or a bare email address. |
| `rules`   | list of Rule (below)     | yes      | Ordered list of path-pattern rules. Use `[]` if the site has no path-specific rules and relies entirely on `default`. |

### Rule fields

Each entry in `rules` is a mapping:

| Field                  | Type    | Required | Description |
|------------------------|---------|----------|--------------|
| `pattern`              | string  | yes      | An absolute glob-style path pattern (must start with `/`). Supports `*` (any characters within a path segment), `**` (any characters across segments), and `?` (single character), using standard glob/`minimatch` semantics. |
| `allow`                | boolean | yes      | `true` to permit agent access to paths matching `pattern`, `false` to forbid it. |
| `rate_limit`           | number  | no       | Maximum requests per minute an agent should make against matching paths. Omit if you don't want to state a limit. Must be a positive number. |
| `require_attribution`  | boolean | no       | If `true`, agents using content from matching paths must attribute the source (e.g. a visible link back). Defaults to `false`/unspecified. |
| `contact`              | string  | no       | Overrides the top-level `contact` for questions about this specific rule. Same format as the top-level field. |

### Path matching semantics: most-specific-pattern-wins

This is the part most likely to bite you if you copy `robots.txt` intuition
verbatim, so it's spelled out precisely:

1. A target path (e.g. `/docs/internal/roadmap.md`) is matched against
   **every** rule's `pattern` using glob semantics (`minimatch`).
2. Among all rules whose pattern matches, the **most specific** one wins —
   not the first one, not the last one by default. Specificity is computed
   the same way real-world `robots.txt` implementations resolve overlapping
   `Allow`/`Disallow` lines: the pattern with the longest **literal
   (non-wildcard) prefix** wins; ties are broken by longest total pattern
   length; further ties are broken by whichever rule appears later in the
   file.
3. This means a narrower `disallow` can override a broader `allow` for a
   subpath (e.g. `/docs/**` allowed, `/docs/internal/**` disallowed), *and*
   a narrower `allow` can carve an exception out of a broader `disallow`
   (e.g. `/private/**` disallowed, `/private/press-kit/**` allowed) — same
   as how real-world `robots.txt` parsers reconcile overlapping directives.
4. If **no** rule matches, the file's top-level `default` applies.
5. `rate_limit`, `require_attribution`, and effective `contact`
   (rule-level override, else the file's top-level `contact`, else
   undefined) all come from whichever single rule won step 2 — they are
   never merged across multiple matching rules.

### What AgentIndex is not

- It does not replace `robots.txt`. Search-engine crawling is still
  `robots.txt`'s job. AgentIndex is a companion file for agent-specific
  concerns `robots.txt` has no vocabulary for.
- It is not an authentication or access-control mechanism (see
  [Limitations](#limitations)).

## Install

```bash
npm install agentindex
# or, to just use the CLI without adding it as a project dependency:
npx agentindex --help
```

Requires Node.js 18+.

## Quick start

Write `.well-known/agent-index.yaml`:

```yaml
version: 1
default: disallow
contact: "mailto:agents@example.com"
rules:
  - pattern: "/docs/**"
    allow: true
    rate_limit: 60
    require_attribution: true
  - pattern: "/docs/internal/**"
    allow: false
  - pattern: "/blog/**"
    allow: true
    rate_limit: 30
```

Validate it:

```bash
$ agentindex validate .well-known/agent-index.yaml
Valid AgentIndex file: .well-known/agent-index.yaml
  version: 1
  default: disallow
  rules:   3
```

Check a specific path against it (locally, no network):

```bash
$ agentindex check /docs/internal/roadmap.md --index .well-known/agent-index.yaml
Path:        /docs/internal/roadmap.md
Verdict:     DISALLOW
Matched by:  rule "/docs/internal/**"
Contact:     mailto:agents@example.com
```

Exit code is `0` when the verdict is `ALLOW`, `1` when it's `DISALLOW` — so
`agentindex check` can gate a script directly:

```bash
agentindex check "$URL" --index policy.yaml && curl "$URL"
```

Fetch a **real** site's published policy over the network and check a URL
against it end-to-end:

```bash
$ agentindex fetch https://example.com /blog/my-post
Fetched:     https://example.com/.well-known/agent-index.yaml
Path:        /blog/my-post
Verdict:     ALLOW
Matched by:  rule "/blog/**"
Rate limit:  30 req/min
```

If the site hasn't published one, `fetch` says so clearly instead of
guessing:

```bash
$ agentindex fetch https://no-agentindex-here.example /anything
No AgentIndex file published at https://no-agentindex-here.example/.well-known/agent-index.yaml.
```

### Using it as a library

```ts
import { validateAgentIndex, checkPath, fetchAndCheck } from "agentindex";

// Validate + parse a YAML string you already have:
const { valid, data, errors } = validateAgentIndex(yamlText);

// Resolve a verdict against parsed data (most-specific-pattern-wins):
if (valid) {
  const result = checkPath(data, "/docs/internal/secret");
  // result.allow, result.matchedPattern, result.rateLimit, result.requireAttribution, result.contact
}

// Or do the whole thing over the network in one call, before your own
// crawler/agent fetches a page:
const { result } = await fetchAndCheck("https://example.com", "/blog/my-post");
if (result.allow) {
  // proceed, respecting result.rateLimit if present
}
```

## CLI reference

```
agentindex validate <file>
    Parse and validate a local AgentIndex YAML file against the v1 schema.
    Exits 0 if valid, 1 if invalid (with per-error file:line:column detail).

agentindex check <url-or-path> --index <file>
    Resolve the verdict for a URL or path against a local AgentIndex file.
    Exits 0 for ALLOW, 1 for DISALLOW.

agentindex fetch <site> <url-or-path>
    Fetch <site>'s real .well-known/agent-index.yaml over HTTP(S), validate
    it, and resolve the verdict for <url-or-path>. Exits 0 for ALLOW, 1 for
    DISALLOW, 1 with a clear message if the site publishes nothing or
    publishes something invalid.

agentindex help
```

## Development

```bash
npm install
npm run build       # compile TypeScript -> dist/
npm test             # run the vitest suite
```

The test suite covers schema validation (valid + several deliberately
invalid fixtures, asserting exact error messages), glob path-matching and
most-specific-wins resolution (including both allow-overriding-disallow and
disallow-overriding-allow by specificity), rate-limit parsing, and a real
end-to-end HTTP round trip against a local test server for the `fetch` path.

## Limitations

Be honest with yourself about what this is, the same way you should be
honest about what `robots.txt` is:

- **It's a signal, not an enforcement mechanism.** Publishing an
  `agent-index.yaml` does not block anything technically. Nothing stops a
  non-compliant agent from ignoring it and fetching whatever it wants — the
  same way nothing stops a scraper from ignoring `robots.txt` today. If you
  need real enforcement, you need auth, rate limiting, or a WAF at the
  server layer, not this file.
- **It only works if both sides opt in.** A site has to choose to publish
  one, and an agent/crawler has to choose to fetch, parse, and respect it.
  There is currently close to zero real-world adoption — this is a new
  proposal, not an established standard. Anyone using it today is an early
  adopter.
- **It is not a legal instrument.** `require_attribution: true` expresses an
  intent/request, not a license grant or a contract. Sites with hard legal
  requirements need actual terms of service, not a YAML flag.
- **Version 1 is deliberately small.** There's no signature/verification
  scheme, no per-agent-identity rules (e.g. different limits for different
  named agents/bots), no support for time-windowed rules, and no revision
  history/versioning beyond a flat `version` integer. These are plausible
  v2 ideas, intentionally left out of this MVP.
- **No registration authority.** Nothing here is submitted to IETF, W3C, or
  any other standards body. "Spec" in this README means "a precisely
  written document other implementations could target," not "a ratified
  standard."

## License

MIT © 2026 AgentIndex contributors — see [LICENSE](./LICENSE).
