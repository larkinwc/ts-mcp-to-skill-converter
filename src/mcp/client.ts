import { connectMCPClient } from './transport';
import type { MCPServerConfig, MCPTool } from './types';

/**
 * Connect to an MCP server and introspect its available tools.
 */
export async function introspectMCPServer(
  config: MCPServerConfig
): Promise<MCPTool[]> {
  const client = await connectMCPClient(config, 'introspector');
  try {
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
