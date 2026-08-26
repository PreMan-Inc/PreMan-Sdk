# The open-source boundary

This SDK is MIT. The PreMan backend is not. As the SDK moves toward PreMan's
testing layer — swarm-driven endpoint testing and self-healing APIs — that line
needs to be stated once rather than re-litigated every time a feature lands.

## The test

> Does this need a PreMan credential, hosted state, or a model call?

If **no**, it belongs in this repository, MIT, and it must run offline.

If **yes**, it belongs in the hosted service.

The question is deliberately about *dependencies*, not about value. Plenty of
genuinely valuable work is offline and belongs here; plenty of thin plumbing
needs a service and does not. Asking "is this a differentiator" invites a
different answer every quarter. Asking "does this need a credential" does not.

Note what the test does *not* say: it says nothing about whether code touches
the network. `assertions.ts` sends HTTP probes at *your* API and is fully open —
it needs no PreMan credential and no hosted state, and its `fetchImpl` is
injectable so it tests offline. "Offline" here means independent of PreMan, not
free of I/O.

## Why this split and not another

A team evaluating PreMan has to answer one question before anything else
matters: *does it find my endpoints, and does it understand their schemas?*
If they cannot read that code, cannot run it without signing up, and cannot fix
their own framework's edge case, they have to take it on faith. Faith is a poor
thing to ask for at the front door.

So the front door is open: reading a repository, recovering schemas, locating
the code behind an endpoint. None of it needs a service. All of it is the part a
team must trust before they will let anything test their API, let alone patch
it.

What genuinely needs to be a service is everything with state or consequence —
scheduling fan-out safely, holding baselines over time, running an agent loop
against a clone, gating a pull request. That is where the hosted product lives,
and it does not need discovery to be closed in order to be worth paying for.

## Open source, in this repository

| Capability | Status |
|---|---|
| Endpoint discovery from any codebase (`preman scan`) | [#39](https://github.com/PreMan-Inc/PreMan-Sdk/issues/39) |
| Request/response/query schema extraction from source models | [#40](https://github.com/PreMan-Inc/PreMan-Sdk/issues/40) |
| Endpoint → source span index (related code chunks) | [#41](https://github.com/PreMan-Inc/PreMan-Sdk/issues/41) |
| Ranking affected chunks for a failing endpoint | [#42](https://github.com/PreMan-Inc/PreMan-Sdk/issues/42) |
| State assertions and read-only HTTP probes | shipped — `src/assertions.ts` |
| Deterministic case generation from a schema | planned, with [#19](https://github.com/PreMan-Inc/PreMan-Sdk/issues/19) |
| Endpoint definition importers (OpenAPI, Postman) | shipped — `src/importers.ts` |
| TypeScript type generation | shipped — `src/typegen.ts` |

Current modules that are independent of PreMan:

`assertions.ts` · `apps.ts` · `catalog.ts` · `config.ts` · `errors.ts` ·
`importers.ts` · `installers.ts` · `llms.ts` · `manifest.ts` · `secrets.ts` ·
`typegen.ts` · `types.ts` · `upstream.ts` · `upstream-hosting.ts`

## Hosted

| Capability | Why it cannot be a library |
|---|---|
| Swarm scheduling and fan-out | Needs pacing, rate ceilings and a circuit breaker across tenants |
| Monitoring, baselines, alert evaluation | Needs durable state over time |
| The autofix agent loop and tool sandbox | Runs a model against a clone under confinement |
| Review gate, push and PR flow | Needs the rule that PreMan never pushes and never merges, enforced centrally |
| Model metering, billing, audit | Needs an authoritative ledger |
| Multi-tenant credential storage | Needs encryption at rest and ownership checks |

Modules that talk to the hosted service:

`client.ts` · `platform-tools.ts` · `middleware.ts` · `tunnel.ts` · `cli.ts`
(spans both — offline subcommands must keep working without a key)

## Rules that follow from this

1. **The offline core must not import the hosted client.** If a module under the
   open list needs `client.ts`, either the module is misplaced or the design is.
2. **The offline core runs with no `PREMAN_API_KEY` and no network.** This is
   enforced in CI, not asserted in prose — see
   [#43](https://github.com/PreMan-Inc/PreMan-Sdk/issues/43).
3. **A gap is reported, never invented.** An endpoint whose schema could not be
   recovered is reported as having none. Guessing a contract from a `return {…}`
   literal fabricates something the author never wrote, and a fabricated
   contract produces failures the customer cannot act on.
4. **Never send a credential the caller did not supply.** Placeholder or
   model-invented credentials are not sent; the case is dropped and the drop is
   reported. `assertions.ts` already enforces this — literal probe headers are
   rejected outright in favour of `headersFromEnv`.
5. **Coverage is stated as measured.** If cases were dropped or never generated,
   say how many. Silent truncation reads as "we tested everything".

Rules 3–5 are not stylistic. Each one is a bug PreMan has already shipped and
had to fix: a repository of GETs coming back with empty schemas, model-suggested
cases sent upstream with fabricated bearer tokens and graded as customer API
failures, and dropped cases counted as coverage.

## What you get without an account

Clone this repository, run `npm install && npm run build`, and the offline core
works with no signup: scan a codebase for endpoints, extract their schemas, map
each endpoint to the code that implements it, and run state assertions and
read-only probes against your own API.

What needs an account: continuous scheduled testing, monitoring and incidents,
automated repair, and pull requests.
