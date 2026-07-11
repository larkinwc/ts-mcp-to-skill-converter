import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { connectMCPClient } from '../mcp/transport';
import type { MCPServerConfig } from '../mcp/types';

export class MCPExecutor {
  private client: Client | null = null;

  constructor(private readonly config: MCPServerConfig) {}

  async connect(): Promise<Client> {
    if (!this.client) {
      this.client = await connectMCPClient(this.config, 'executor');
    }
    return this.client;
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    const client = await this.connect();
    const response = await client.listTools();
    return response.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
    }));
  }

  async describeTool(toolName: string): Promise<unknown> {
    const client = await this.connect();
    const response = await client.listTools();
    const tool = response.tools.find((candidate) => candidate.name === toolName);
    if (!tool) return null;
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    };
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    const client = await this.connect();
    const response = await client.callTool({
      name: toolName,
      arguments: args,
    });
    return response.content;
  }

  async close(): Promise<void> {
    if (!this.client) return;
    await this.client.close();
    this.client = null;
  }
}
