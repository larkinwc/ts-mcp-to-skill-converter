import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { MCPServerConfig, MCPTool } from './types.js';

/**
 * Connect to an MCP server and introspect its available tools.
 */
export async function introspectMCPServer(config: MCPServerConfig): Promise<MCPTool[]> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
  });

  const client = new Client(
    { name: 'mcp-to-skill-introspector', version: '1.0.0' },
    { capabilities: {} }
  );

  try {
    await client.connect(transport);

    const toolsResponse = await client.listTools();

    return toolsResponse.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
    }));
  } finally {
    await client.close();
  }
}
