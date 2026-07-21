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

KEEP the graph canvas, zoom, ports, inspector, palette. DELEGATE editing, diff, git
history, commit UX to native VS Code — and, as of the agent-context decision below,
DELEGATE the AI conversation itself to whatever agent the dev already has open. A
`<textarea>` editor in the webview, or a chat/chip surface rendered inside BlockNet's own
UI, is the signal this rule was broken.

## We are the map, not the assistant (2026-07-21, supersedes the earlier "context-chip" framing)

BlockNet computes and renders ground truth about a repo's structure — blocks, real import
edges, flagged risk with evidence. It never renders its own AI chat, chip, or suggestion
UI, and never will. The reasoning: every dev this tool matters to already has an AI agent
open somewhere — Claude Code, Copilot, Cursor, whatever — and that agent's actual weakness
isn't "no chat surface," it's that it has no fast, exact way to know real cross-file
structure. It reconstructs that today by grepping, which is slow and provably wrong for
anything grep can't resolve (barrel-file re-exports, path aliases, dynamic imports) — a
real import-graph analyzer resolves all of that correctly, and BlockNet already *is* one
(`core`, zero VS Code deps, `decisions/0002`). So the product's job is to be the ground an
agent's own reasoning stands on, not a second, competing place to have the conversation.
Concretely: any agent that can run a shell command gets a `blocknet` CLI query surface
(`docs/planning/ROADMAP-V2.md`'s v2.2); a human browsing the graph gets a click-to-copy
context handoff into whatever agent session they're already running. Neither path ever
opens a chat window inside BlockNet itself.

This reframes v1's "AI-addressable architecture" line (top of this doc) precisely: BlockNet
is not *addressed by* AI through a UI it built — it's *queried by* AI through data it
computed. A dev working with an AI agent should never be one grep-guess away from a wrong
mental model of their own codebase; closing that gap, for every language the codebase is
written in eventually (not just TS/JS — `ROADMAP-V2.md`'s v2.5), is the actual differentiator
this doc's "prior-art humility" section below asks for, not a bolted-on chat feature.

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

The belief that agent-context access — a `blocknet` CLI query surface plus click-to-copy
context handoff, `docs/planning/ROADMAP-V2.md`'s v2.2 — is the daily-use retention loop is a
hypothesis, not a fact. v1 is deliberately narrow so the graph gets loved on its own first —
agent-context access bolted onto an untrusted graph is noise, not signal. (This hypothesis
was reframed 2026-07-21 — see "We are the map, not the assistant" above — from an earlier,
now-superseded version of itself that assumed BlockNet would build its own in-UI AI chat/chip
surface. The daily-use bet is unchanged; the delivery mechanism is not.)
