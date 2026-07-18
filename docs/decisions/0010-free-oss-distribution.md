# ADR-0010: Distribution is free and open source

## Status
Accepted

## Date
2026-07-10

## Context
BlockNet needs a monetization stance before it ships, if only to decide what infrastructure
v1 does *not* need to build.

## Decision
Free, open source, distributed via the VS Code Marketplace and OpenVSX. No backend, no
auth, no billing, no telemetry.

## Alternatives Considered

### Freemium (paid AI/team features)
- Rejected for v1: `docs/PRINCIPLES.md` — the retention hypothesis is untested; monetizing
  before the graph itself is proven loved would optimize the wrong thing. Revisit only if
  retention proves out post-ship, on data, not upfront speculation.

## Consequences
No telemetry burden means no analytics dependency anywhere in the stack — this is a hard
constraint checked in `docs/architecture/REPO-STANDARDS.md`, not just a cost-saving
preference. Audience and trust come first; a monetization decision is explicitly deferred,
not designed around.
