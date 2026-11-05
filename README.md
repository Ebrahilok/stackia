# Stack IA

A self-hosted office for AI development agents. One machine hosts the agents; you talk to them from any browser on your private network.

- **Automatic context:** every session starts from a small package (role, project brief, memory, last handoff), so long conversations are never needed.
- **Auto-clean:** a session ends at its context limit; the handoff carries the work over.
- **Safe by default:** tasks need approval, run in their own git worktree, and only push their own `stackia/T-n` branch after you confirm.
- **No dependencies:** Node.js 22 or later.

## Setup

1. Copy `stackia.config.example.json` to `stackia.config.json` and fill in your projects.
2. Run `npm start`. The owner key is created in `<dataDir>/owner.token`.
3. On Windows, run `tools/install-windows.ps1` to start it at logon. It must run in your desktop session: agent CLIs cannot read their logins from a service or an SSH session.

Set `host` to a private address only. Do not expose the port to the Internet.

## Docs

- `docs/DESIGN.md`: full design, including parts not built yet (in Spanish).
- `mockups/`: office mockups and the scripts that generate them.

## Tests

`npm test` runs everything against a fake CLI, so it spends no quota.
