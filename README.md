# mcp-to-skill

Convert MCP servers to Claude Skills. Save ~90% context tokens.

## Requirements

- Node.js 18+
- npm/npx

## Usage

### 1. Create a MCP config to consume

**Stdio MCP (npx-based):**
```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {"GITHUB_TOKEN": "your-token"}
    }
  }
}
```

<details>
<summary>HTTP MCP</summary>

```json
{
  "mcpServers": {
    "my-server": {
      "type": "http",
      "url": "http://localhost:8080/mcp"
    }
  }
}
```
</details>

<details>
<summary>Direct format (without mcpServers wrapper)</summary>

```json
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {"GITHUB_TOKEN": "your-token"}
}
```
</details>

### 2. Generate the skill

```bash
npx -y mcp-to-skill generate \
  --mcp-config my-mcp.json \
  --output-dir ./skills/my-skill
```

### 3. Copy to Claude skills directory

```bash
cp -r ./skills/my-skill ~/.claude/skills/
```

Claude discovers it automatically. The generated `SKILL.md` instructs Claude to call tools via:

```bash
npx -y mcp-to-skill exec \
  --config /path/to/mcp-config.json \
  --call '{"tool": "tool_name", "arguments": {...}}'
```

## Output

```
skills/my-skill/
├── SKILL.md         # Instructions for Claude (~100 tokens)
└── mcp-config.json  # MCP server config
```

## Fine-tuning

In my experience it is best to fine tune the skill.md a little by enhancing the description to be more concise about the tool (e.g. give the agent context on the purpose of the mcp/tool). Additionally some MCP's tool usage descriptions are too verbose and can be edited down for further savings.

## Development

```bash
git clone https://github.com/larkinwc/ts-mcp-to-skill.git
cd ts-mcp-to-skill
npm install
npm run build

# Run locally
npx tsx src/index.ts generate --mcp-config config.json --output-dir ./skills/name

# Test executor
npx tsx src/index.ts exec --config mcp-config.json --list
npx tsx src/index.ts exec --config mcp-config.json --describe tool_name
npx tsx src/index.ts exec --config mcp-config.json --call '{"tool": "...", "arguments": {}}'
```

