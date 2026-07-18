# Docs — how this folder is organized

Three kinds of document, three lifetimes. Don't mix them.

| Folder / file | Contains | Lifetime |
|---|---|---|
| [`architecture/`](./architecture/README.md) | The literal shape of the system: layers, directory tree, data model, protocol, state ownership, build. One concept per file. Nothing here is "open" or "TBD" — if it's undecided, it isn't architecture yet, it's a question for `decisions/`. | Permanent — ground truth, updated in place as the system evolves, never rewritten wholesale. |
| `decisions/` | ADRs — one per expensive-to-reverse decision, with alternatives and rationale. Numbered, never deleted; superseded by a new ADR when reversed. | Permanent — historical record. |
| `PRINCIPLES.md` | Product philosophy that isn't tied to any one layer or task: why this shape of product, what traps to avoid. | Permanent, short, rarely edited. |
| `planning/` | Task breakdowns, checkpoints, backlogs, roadmaps. Tied to a specific version's build effort. | Temporary — becomes clutter once that version ships. Safe to archive/delete after v1 ships; the architecture and decisions it produced live on elsewhere. |

**Rule of thumb:** if a future contributor needs it to understand *what BlockNet is*, it
belongs in `architecture/`, `decisions/`, or `PRINCIPLES.md`. If they need it to understand
*what we're building right now*, it belongs in `planning/`.
