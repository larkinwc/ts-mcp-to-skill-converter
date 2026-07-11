# mcp-to-skill

[![npm](https://img.shields.io/npm/v/mcp-to-skill)](https://www.npmjs.com/package/mcp-to-skill)
[![CI](https://github.com/larkinwc/ts-mcp-to-skill/actions/workflows/ci.yml/badge.svg)](https://github.com/larkinwc/ts-mcp-to-skill/actions/workflows/ci.yml)

Convert MCP servers to Agent Skills with progressive disclosure instead of preloading every tool definition.

## Requirements

- Node.js 22.12 or newer
- npm or npx

## Generate a skill

Create an MCP configuration. Environment references are resolved when the generated skill runs, so secrets do not need to be copied into the skill:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Generate the skill:

```bash
npx -y mcp-to-skill generate \
  --mcp-config github-mcp.json \
  --output-dir ./skills/github
```

Copy it to the skills directory used by your agent:

```bash
cp -r ./skills/github ~/.claude/skills/
```

Generated files:

```text
skills/github/
├── SKILL.md
├── mcp-config.json
└── tools.json
```

`tools.json` is a reviewable tool-schema snapshot used by offline generation and refresh.

## Execute tools safely

Write the complete call payload to a JSON file rather than interpolating user-controlled values into a shell command:

```json
{
  "tool": "search_repositories",
  "arguments": {
    "query": "language:typescript mcp"
  }
}
```

```bash
npx -y mcp-to-skill exec \
  --config "./skills/github/mcp-config.json" \
  --call-file "./call.json"
```

Standard input is also supported:

```bash
npx -y mcp-to-skill exec \
  --config "./skills/github/mcp-config.json" \
  --call-stdin < "./call.json"
```

Other executor operations:

```bash
npx -y mcp-to-skill exec --config "./skills/github/mcp-config.json" --list
npx -y mcp-to-skill exec --config "./skills/github/mcp-config.json" --describe search_repositories
```

The legacy `--call '<json>'` form remains available for trusted, static payloads, but generated skills use `--call-file` so apostrophes, newlines, and other shell metacharacters remain data.

## Multiple servers

When a Claude Desktop-style configuration contains multiple servers, select one explicitly:

```bash
npx -y mcp-to-skill generate \
  --mcp-config claude_desktop_config.json \
  --server github \
  --output-dir ./skills/github
```

Or generate every server into a safe, normalized subdirectory:

```bash
npx -y mcp-to-skill generate \
  --mcp-config claude_desktop_config.json \
  --all \
  --output-dir ./skills
```

Names that normalize to the same skill directory are rejected rather than overwritten.

## HTTP, SSE, and authentication

Modern Streamable HTTP:

```json
{
  "name": "remote",
  "type": "http",
  "url": "https://example.com/mcp",
  "headers": {
    "X-Tenant": "${TENANT_ID}"
  },
  "auth": {
    "type": "bearer",
    "token": "${MCP_TOKEN}"
  }
}
```

Legacy SSE endpoints use `"type": "sse"`.

Machine-to-machine OAuth client credentials are supported through the MCP SDK:

```json
{
  "name": "remote",
  "type": "http",
  "url": "https://example.com/mcp",
  "auth": {
    "type": "oauth-client-credentials",
    "clientId": "${MCP_CLIENT_ID}",
    "clientSecret": "${MCP_CLIENT_SECRET}",
    "scope": "mcp:tools"
  }
}
```

Literal values still work, but generation warns when likely secrets would be copied. Missing environment references fail with the variable name and never print its value.

## Inspect and generate offline

Capture a machine-readable snapshot:

```bash
npx -y mcp-to-skill inspect \
  --config remote-mcp.json \
  --output remote-tools.json
```

Generate without connecting to the server:

```bash
npx -y mcp-to-skill generate \
  --mcp-config remote-mcp.json \
  --tools remote-tools.json \
  --output-dir ./skills/remote \
  --json
```

Live introspection failures stop generation by default. Use `--allow-empty` only when a deliberately empty skill is required.

## Refresh a generated skill

Edit content only between the custom-content markers in `SKILL.md`, then refresh:

```bash
npx -y mcp-to-skill refresh ./skills/remote
```

Refresh re-introspects the server, updates `SKILL.md` and `tools.json`, preserves the marked custom instructions, and reports added, removed, and changed tools.

Use an offline snapshot when the server is unavailable:

```bash
npx -y mcp-to-skill refresh ./skills/remote --tools remote-tools.json --json
```

For pre-0.3 skills without custom-content markers, refresh preserves the previous file as `SKILL.md.previous` before writing the managed template.

## Migration to 0.3

Version 0.3 raises the runtime requirement from Node 18 to Node 22.12 and changes generation behavior:

- Introspection errors now fail instead of silently generating zero tools.
- Multi-server configurations require `--server` or `--all`.
- Generated skills include `tools.json`.
- Generated tool calls use `--call-file`.
- Skill names are normalized to lowercase, hyphenated identifiers with a 64-character limit.
- Refresh preserves content inside managed custom-content markers.

## Development

```bash
git clone https://github.com/larkinwc/ts-mcp-to-skill.git
cd ts-mcp-to-skill
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Run the source CLI:

```bash
npx tsx src/index.ts --version
npx tsx src/index.ts generate \
  --mcp-config config.json \
  --output-dir ./skills/name
```

## License

MIT
