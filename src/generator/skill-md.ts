import type { MCPTool } from '../mcp/types.js';

/**
 * Generate SKILL.md content for a skill.
 */
export function generateSkillMd(
  serverName: string,
  tools: MCPTool[]
): string {
  const toolList = tools
    .map((t) => `- \`${t.name}\`: ${t.description ?? 'No description'}`)
    .join('\n');

  const toolCount = tools.length;

  return `---
name: ${serverName}
description: Dynamic access to ${serverName} MCP server (${toolCount} tools)
version: 1.0.0
---

# ${serverName} Skill

This skill provides dynamic access to the ${serverName} MCP server without loading all tool definitions into context.

## Context Efficiency

Traditional MCP approach:
- All ${toolCount} tools loaded at startup
- Estimated context: ${toolCount * 500} tokens

This skill approach:
- Metadata only: ~100 tokens
- Full instructions (when used): ~5k tokens
- Tool execution: 0 tokens (runs externally)

## How This Works

Instead of loading all MCP tool definitions upfront, this skill:
1. Tells you what tools are available (just names and brief descriptions)
2. You decide which tool to call based on the user's request
3. Generate a JSON command to invoke the tool
4. The executor handles the actual MCP communication

## Available Tools

${toolList}

## Usage Pattern

When the user's request matches this skill's capabilities:

**Step 1: Identify the right tool** from the list above

**Step 2: Generate a tool call** in this JSON format:

\`\`\`json
{
  "tool": "tool_name",
  "arguments": {
    "param1": "value1",
    "param2": "value2"
  }
}
\`\`\`

**Step 3: Execute via bash:**

\`\`\`bash
cd $SKILL_DIR
./executor --call 'YOUR_JSON_HERE'
\`\`\`

IMPORTANT: Replace $SKILL_DIR with the actual discovered path of this skill directory.

## Getting Tool Details

If you need detailed information about a specific tool's parameters:

\`\`\`bash
cd $SKILL_DIR
./executor --describe tool_name
\`\`\`

This loads ONLY that tool's schema, not all tools.

## Examples

### Example 1: Simple tool call

User: "Use ${serverName} to do X"

Your workflow:
1. Identify tool: \`example_tool\`
2. Generate call JSON
3. Execute:

\`\`\`bash
cd $SKILL_DIR
./executor --call '{"tool": "example_tool", "arguments": {"param1": "value"}}'
\`\`\`

### Example 2: Get tool details first

\`\`\`bash
cd $SKILL_DIR
./executor --describe example_tool
\`\`\`

Returns the full schema, then you can generate the appropriate call.

## Error Handling

If the executor returns an error:
- Check the tool name is correct
- Verify required arguments are provided
- Ensure the MCP server is accessible

## Performance Notes

Context usage comparison for this skill:

| Scenario | MCP (preload) | Skill (dynamic) |
|----------|---------------|-----------------|
| Idle | ${toolCount * 500} tokens | 100 tokens |
| Active | ${toolCount * 500} tokens | 5k tokens |
| Executing | ${toolCount * 500} tokens | 0 tokens |

Savings: ~${Math.round((1 - 5000 / (toolCount * 500)) * 100)}% reduction in typical usage

---

*This skill was auto-generated from an MCP server configuration.*
*Generator: mcp-to-skill (TypeScript)*
`;
}
