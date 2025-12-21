# mcp-to-skill

Convert any MCP server into a Claude Skill with 90% context savings and portable standalone executables.

## Why This Exists

MCP servers are great but load all tool definitions into context at startup. With 20+ tools, that's 30-50k tokens gone before Claude does any work.

This converter applies the "progressive disclosure" pattern to any MCP server:
- **Startup**: ~100 tokens (just metadata)
- **When used**: ~5k tokens (full instructions)
- **Executing**: 0 tokens (runs externally via standalone binary)

## Quick Start

```bash
# Install dependencies
npm install

# 1. Create your MCP config file
cat > github-mcp.json << 'EOF'
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {"GITHUB_TOKEN": "your-token-here"}
}
EOF

# 2. Convert to Skill (compiles standalone binary for current platform)
bun run dev --mcp-config github-mcp.json --output-dir ./skills/github

# 3. Copy to Claude
cp -r ./skills/github ~/.claude/skills/
```

Done! Claude can now use GitHub tools with minimal context.

## Cross-Platform Compilation

The generated executor is compiled to a standalone binary using Bun. No runtime dependencies needed!

```bash
# Compile for current platform (default)
bun run dev --mcp-config config.json --output-dir ./skills/myskill

# Compile for all platforms
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target all

# Compile for specific platform
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target linux-x64
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target darwin-arm64
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target darwin-x64
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target windows-x64
```

## What It Generates

The converter creates:
- `SKILL.md` - Instructions for Claude (~100 tokens metadata)
- `executor` - Standalone binary (no dependencies!)
- `executor.ts` - Source code (for rebuilding)
- `mcp-config.json` - MCP server configuration
- `package.json` - For rebuilding if needed

## Context Savings

**Before (MCP)**:
```
20 tools = 30k tokens always loaded
Context available: 170k / 200k = 85%
```

**After (Skills)**:
```
20 skills = 2k tokens metadata
When 1 skill active: 7k tokens
Context available: 193k / 200k = 96.5%
```

## Real Example

GitHub MCP server (8 tools):

| Metric | MCP | Skill | Savings |
|--------|-----|-------|---------|
| Idle | 8,000 tokens | 100 tokens | 98.75% |
| Active | 8,000 tokens | 5,000 tokens | 37.5% |

## Works With

Any standard MCP server:
- @modelcontextprotocol/server-github
- @modelcontextprotocol/server-slack
- @modelcontextprotocol/server-filesystem
- @modelcontextprotocol/server-postgres
- Your custom MCP servers

## Requirements

- [Bun](https://bun.sh/) (for compilation)
- Node.js 18+ (or Bun)

```bash
# Install Bun (if not already installed)
curl -fsSL https://bun.sh/install | bash

# Install project dependencies
npm install
# or
bun install
```

## How It Works

```
┌─────────────────────────────────────┐
│ Your MCP Config                     │
│ (JSON file)                         │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ mcp-to-skill                        │
│ - Reads config                      │
│ - Introspects MCP server            │
│ - Generates Skill structure         │
│ - Compiles standalone binary        │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Generated Skill                     │
│ ├── SKILL.md (100 tokens)           │
│ ├── executor (standalone binary)    │
│ ├── executor.ts (source)            │
│ └── config files                    │
└─────────────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────┐
│ Claude                              │
│ - Loads metadata only               │
│ - Full docs when needed             │
│ - Calls executor binary for tools   │
└─────────────────────────────────────┘
```

## Examples

### Example 1: GitHub Integration

```bash
# Create config
cat > github.json << 'EOF'
{
  "name": "github",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": {"GITHUB_TOKEN": "ghp_your_token"}
}
EOF

# Convert
bun run dev --mcp-config github.json --output-dir ./skills/github

# Result: GitHub tools accessible with 100 tokens vs 8k
```

### Example 2: Multiple Servers

```bash
# Convert multiple MCP servers
for config in configs/*.json; do
  name=$(basename "$config" .json)
  bun run dev --mcp-config "$config" --output-dir "./skills/$name"
done
```

### Example 3: Build for Distribution

```bash
# Build for all platforms
bun run dev --mcp-config config.json --output-dir ./skills/myskill --target all

# Generated files:
# skills/myskill/executor-linux-x64
# skills/myskill/executor-darwin-arm64
# skills/myskill/executor-darwin-x64
# skills/myskill/executor-windows-x64.exe
```

## Testing Generated Skills

```bash
cd skills/your-skill

# List tools
./executor --list

# Describe a tool
./executor --describe tool_name

# Call a tool
./executor --call '{"tool": "tool_name", "arguments": {...}}'
```

## Rebuilding from Source

If you need to rebuild the executor:

```bash
cd skills/your-skill

# Install dependencies
bun install

# Build for current platform
bun run build

# Build for all platforms
bun run build:all
```

## When To Use

**Use this converter when:**
- You have 10+ tools
- Context space is tight
- Most tools won't be used in each conversation
- Tools are independent
- You want portable, standalone executors

**Stick with MCP when:**
- You have 1-5 tools
- Need complex OAuth flows
- Need persistent connections

**Best approach: Use both**
- MCP for core tools
- Skills for extended toolset

## Development

```bash
# Install dependencies
bun install

# Run in development mode
bun run dev --mcp-config example-github-mcp.json --output-dir ./test-output

# Build for distribution
bun run build
```

## Credits

Inspired by:
- [playwright-skill](https://github.com/lackeyjb/playwright-skill) by @lackeyjb
- [Anthropic Skills](https://www.anthropic.com/news/skills) framework
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Bun](https://bun.sh/) for standalone binary compilation

## License

MIT
