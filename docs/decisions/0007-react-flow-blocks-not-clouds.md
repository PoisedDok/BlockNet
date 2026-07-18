# ADR-0007: Render with React Flow; blocks as cards, not organic clouds

## Status
Accepted

## Date
2026-07-10

## Context
The design handoff prototype (`design_handoff_blocknet_extension/BlockNet.dc.html`)
establishes a specific visual language — block cards with ports — that a force-directed
"glowing cloud" layout (the Gource look, `docs/PRINCIPLES.md`) would not preserve.

## Decision
React Flow (xyflow) in the webview. Visual primitive is **block cards with output→input
ports** — edges leave a source card's right edge and enter a target card's left edge,
preserving the prototype convention — not organic force-directed node clouds.

## Alternatives Considered

### d3-force / organic layout
- Pros: matches the famous "beautiful repo video" aesthetic; good for very high node counts.
- Rejected for the macro (block) view: blocks are legible at the architecture level; a
  cloud layout is pretty but unreadable when the whole point is "understand the shape in
  three seconds." Candidate for the v2 micro/file view instead
  (`docs/planning/ROADMAP-V2.md` v2.0), where node counts are 10–100× higher and legibility
  trade-offs shift.

## Consequences
React Flow provides ports, edges, pan/zoom/drag/selection out of the box — matches the
high-fidelity prototype closely with comparatively little custom rendering code. See
`docs/architecture/DIRECTORY-TREE.md` (`extension/webview/src/flow/`) for the concrete
component split.
