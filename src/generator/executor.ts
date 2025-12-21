/**
 * Generate the executor TypeScript source code.
 * This will be compiled to a standalone binary.
 */
export function generateExecutorTs(): string {
  return `#!/usr/bin/env bun
/**
 * MCP Skill Executor
 * Handles dynamic communication with the MCP server.
 * This file is compiled to a standalone binary.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface MCPConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ToolCall {
  tool: string;
  arguments?: Record<string, unknown>;
}

class MCPExecutor {
  private config: MCPConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(config: MCPConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: this.config.env,
    });

    this.client = new Client(
      { name: 'skill-executor', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
  }

  async listTools(): Promise<{ name: string; description?: string }[]> {
    if (!this.client) await this.connect();
    const response = await this.client!.listTools();
    return response.tools.map((t) => ({
      name: t.name,
      description: t.description,
    }));
  }

  async describeTool(toolName: string): Promise<unknown> {
    if (!this.client) await this.connect();
    const response = await this.client!.listTools();
    const tool = response.tools.find((t) => t.name === toolName);
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
    if (!this.client) await this.connect();
    const response = await this.client!.callTool({
      name: toolName,
      arguments: args,
    });
    return response.content;
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close();
    }
  }
}

function parseArgs(args: string[]): {
  list: boolean;
  describe?: string;
  call?: string;
} {
  const result: { list: boolean; describe?: string; call?: string } = {
    list: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--list') {
      result.list = true;
    } else if (arg === '--describe' && args[i + 1]) {
      result.describe = args[++i];
    } else if (arg === '--call' && args[i + 1]) {
      result.call = args[++i];
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Load config - look relative to executable location
  const configPath = path.join(__dirname, 'mcp-config.json');
  if (!fs.existsSync(configPath)) {
    console.error(\`Error: Configuration file not found: \${configPath}\`);
    process.exit(1);
  }

  const config: MCPConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  const executor = new MCPExecutor(config);

  try {
    if (args.list) {
      const tools = await executor.listTools();
      console.log(JSON.stringify(tools, null, 2));
    } else if (args.describe) {
      const schema = await executor.describeTool(args.describe);
      if (schema) {
        console.log(JSON.stringify(schema, null, 2));
      } else {
        console.error(\`Tool not found: \${args.describe}\`);
        process.exit(1);
      }
    } else if (args.call) {
      const callData: ToolCall = JSON.parse(args.call);
      const result = await executor.callTool(
        callData.tool,
        callData.arguments ?? {}
      );
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('Usage:');
      console.log('  ./executor --list');
      console.log('  ./executor --describe <tool_name>');
      console.log(
        "  ./executor --call '{\\"tool\\": \\"name\\", \\"arguments\\": {...}}'"
      );
    }
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  } finally {
    await executor.close();
  }
}

main();
`;
}
