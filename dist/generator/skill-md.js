/**
 * Map JSON Schema types to short type hints.
 */
function shortType(jsonSchemaType) {
    const typeMap = {
        string: 'str',
        boolean: 'bool',
        integer: 'int',
        number: 'num',
        array: 'arr',
        object: 'obj',
    };
    if (typeof jsonSchemaType === 'string') {
        return typeMap[jsonSchemaType] ?? jsonSchemaType;
    }
    return '';
}
/**
 * Format a tool's inputSchema into a compact signature.
 * Example: "interact_npc(action*:str, name?:str, id?:int)"
 * - `*` suffix = required parameter
 * - `?` suffix = optional parameter
 * - `:type` = parameter type hint
 */
function formatSignature(tool) {
    const schema = tool.inputSchema;
    if (!schema || typeof schema !== 'object') {
        return tool.name;
    }
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    if (typeof properties !== 'object' || properties === null) {
        return tool.name;
    }
    const props = properties;
    const params = Object.keys(props)
        .map((name) => {
        const suffix = required.has(name) ? '*' : '?';
        const type = shortType(props[name]?.type);
        return type ? `${name}${suffix}:${type}` : `${name}${suffix}`;
    })
        .join(', ');
    return params ? `${tool.name}(${params})` : tool.name;
}
/**
 * Generate SKILL.md content for a skill.
 */
export function generateSkillMd(serverName, tools, version) {
    const toolList = tools
        .map((t) => `- \`${formatSignature(t)}\`: ${t.description ?? 'No description'}`)
        .join('\n');
    const toolCount = tools.length;
    const npxCmd = `npx -y mcp-to-skill@${version} exec`;
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

**Step 2: Execute the tool:**

\`\`\`bash
${npxCmd} --config $SKILL_DIR/mcp-config.json --call '{"tool": "tool_name", "arguments": {"param1": "value1"}}'
\`\`\`

IMPORTANT: Replace \`$SKILL_DIR\` with the actual path to this skill directory.

## Commands

**Call a tool:**
\`\`\`bash
${npxCmd} --config $SKILL_DIR/mcp-config.json --call '{"tool": "tool_name", "arguments": {...}}'
\`\`\`

**List all tools:**
\`\`\`bash
${npxCmd} --config $SKILL_DIR/mcp-config.json --list
\`\`\`

**Get tool schema (if needed):**
\`\`\`bash
${npxCmd} --config $SKILL_DIR/mcp-config.json --describe tool_name
\`\`\`

## Example

User: "Use ${serverName} to do X"

\`\`\`bash
${npxCmd} --config $SKILL_DIR/mcp-config.json --call '{"tool": "example_tool", "arguments": {"param1": "value"}}'
\`\`\`

## Error Handling

If the executor returns an error:
- Check the tool name is correct
- Verify required arguments are provided (marked with \`*\` in signatures above)
- Ensure the MCP server is accessible

---

*This skill was auto-generated from an MCP server configuration.*
*Generator: [mcp-to-skill](https://github.com/larkinwc/ts-mcp-to-skill)*
`;
}
