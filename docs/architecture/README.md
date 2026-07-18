# Architecture — Index

Start with [OVERVIEW.md](./OVERVIEW.md). Then, in whatever order the question at hand needs:

| Doc | Answers |
|---|---|
| [OVERVIEW.md](./OVERVIEW.md) | What is BlockNet v1, who are the five participants? |
| [LAYERS.md](./LAYERS.md) | What are the six module layers, what order do they get built and cleared in? |
| [DIRECTORY-TREE.md](./DIRECTORY-TREE.md) | Where does every file live, what does each one do? |
| [DATA-MODEL.md](./DATA-MODEL.md) | What are the ten core types (`BlockNode`, `Edge`, `Risk`, `GraphResult`, …)? |
| [PROTOCOL.md](./PROTOCOL.md) | What messages cross the host↔webview boundary? |
| [PROCESS-BOUNDARY.md](./PROCESS-BOUNDARY.md) | How does the extension talk to `core` without blocking? |
| [STATE-OWNERSHIP.md](./STATE-OWNERSHIP.md) | Which piece of state lives where, and for how long? |
| [FLOWS.md](./FLOWS.md) | Step by step, what happens on cold open / save / click ⤢ / drag? |
| [BUILD.md](./BUILD.md) | How do three build outputs become one `.vsix`? |
| [ENGINEERING-CONSTRAINTS.md](./ENGINEERING-CONSTRAINTS.md) | What's binding for every task (activation, threading, theming, CSP)? |
| [REPO-STANDARDS.md](./REPO-STANDARDS.md) | What does the repo root and packaging need to look like? |

Every fact here is stated, not proposed — see [../decisions/](../decisions/) for the
alternatives that were rejected and why.
