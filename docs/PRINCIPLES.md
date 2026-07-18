# Principles

Product philosophy that isn't tied to any one layer or task. Re-read before promoting
anything from `planning/ROADMAP-V2.md` — these are the guardrails that keep v2 from
becoming v1's mistake.

## Linters check code; nothing checks the map

tsc/eslint/ruff are the *sensors* — single-file, rule-local, language-siloed. BlockNet is
the aggregation layer that turns their signals into a spatial, cross-boundary,
AI-addressable architecture. Build the aggregator, never the parsers.

## The Gource lesson (why this is buildable at all)

The famous "repo as glowing nodes" video is layout physics over a filesystem tree —
beautiful but architecturally false (edges are folder containment, not imports). Layout
beauty (d3-force / React Flow) and data truth (real import edges) are independent layers.
Beauty is commodity; truth is the product. Any time the pretty layer jumps the queue in
priority, stop and check.

## KEEP / DELEGATE (from the design handoff, still binding)

KEEP the graph canvas, zoom, ports, inspector, palette, context-chip model. DELEGATE
editing, diff, git history, commit UX to native VS Code. A `<textarea>` editor in the
webview is the signal this rule was broken.

## False positives are fatal

Every risk check ships only when its false-positive rate on real repos is ~zero. Trust,
once lost to a wrong red edge, doesn't come back. This is why v1 ships exactly two checks
(cycles, boundary) and defers reachability-based checks to v2.

## The 70/30 trap

Scaffold and webview look like most of the work and are the easy 70%. The engine and
trustworthy analysis are the valuable 30% that consumes the real effort. Progress on the
pretty parts is not progress on the product — this is why `core` is Phase 1 and `extension`
doesn't start until Checkpoint B (Layer 1–2 complete, schema frozen), which itself cannot be
reached without Checkpoint A (the truth gate) passing first.

## Prior-art humility

CodeSee built approximately this and shut down; IDE diagram views exist largely unused.
"Nothing like this exists" is partly cope — the differentiators must be truthful risk
detection, native delegation, and (eventually) AI context, or this is another pretty graph.
Validate retention with real users before scaling scope.

## Performance is existential

5k–50k-file repos, child process, cache, incremental invalidation. A frozen editor or a
minute-late graph gets uninstalled before it gets a second chance.

## The retention hypothesis (deliberately untested in v1)

The belief that click-to-context (AI chips + chat, deferred to v2.2) is the daily-use
retention loop is a hypothesis, not a fact. v1 is deliberately narrow so the graph gets
loved on its own first — an AI feature bolted onto an untrusted graph is noise, not signal.
