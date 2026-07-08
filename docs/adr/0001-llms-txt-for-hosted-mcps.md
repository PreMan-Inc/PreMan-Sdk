---
status: proposed
---

# Auto-generated MCP llms.txt for all Hosted MCPs; hard requirement only for certified public listing

Every Hosted MCP must have an MCP llms.txt document available for the Hosted MCP overview UI. We will not block deploy or import when upstream operators have not supplied one. Instead, PreMan auto-generates MCP llms.txt at create/import time from the best available metadata (name, description, tool catalog, import source, docs URL when present). Operators may override with a provided file. A strict llms.txt requirement applies only to a future certified public marketplace tier, not to default workspace MCPs.

Remote MCP imports (including bulk Apify actor proxies) and legacy MCPs cannot satisfy a hard deploy gate without either halting automation or producing thousands of manual documents. The product goal is agent discoverability on the overview page, not compliance friction at import.

## Considered options

1. **Hard requirement at deploy/import** — Rejected: blocks `importRemoteMcp`, Apify bulk import (~1,300 actors), and STDIO tunnels where no doc source exists.
2. **Soft requirement (warn only)** — Rejected alone: Overview panel would often be empty; does not meet "show llms.txt below activity graph" without a fill strategy.
3. **Lazy generation on first overview view** — Rejected as sole strategy: racey UX, complicates API contracts, harder to test in SDK.
4. **Mandatory auto-gen at create + optional operator override + hard gate only for certified public listing** — Accepted: scales to bulk imports, supports dashboard always-on content, preserves path to quality enforcement where it matters.

## Consequences

- Backend stores `mcp_llms_txt` content and `mcp_llms_txt_status` on Hosted MCP records.
- SDK gains optional fields on deploy/import for `mcpLlmsTxt` override; otherwise server generates.
- Backfill job generates MCP llms.txt for pre-existing Hosted MCPs.
- Overview UI reads stored content; does not fetch upstream `/llms.txt` synchronously on page load.
- "Certified public listing" policy is deferred until that product surface exists.
