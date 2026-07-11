import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { PACKAGE_VERSION } from '../version';
import { resolveConfigEnvironment } from './config';
import { isHttpConfig, type MCPHttpConfig, type MCPServerConfig } from './types';

function createHttpTransport(config: MCPHttpConfig): Transport {
  const headers = { ...config.headers };
  if (config.auth?.type === 'bearer') {
    headers.Authorization = `Bearer ${config.auth.token}`;
  }

  const authProvider = config.auth?.type === 'oauth-client-credentials'
    ? new ClientCredentialsProvider({
        clientId: config.auth.clientId,
        clientSecret: config.auth.clientSecret,
        clientName: 'mcp-to-skill',
        scope: config.auth.scope,
      })
    : undefined;

  const options = {
    requestInit: { headers },
    authProvider,
  };

  return config.type === 'sse'
    ? new SSEClientTransport(new URL(config.url), options)
    : new StreamableHTTPClientTransport(new URL(config.url), options);
}

export function createMCPTransport(
  unresolvedConfig: MCPServerConfig,
  environment: NodeJS.ProcessEnv = process.env
): Transport {
  const config = resolveConfigEnvironment(unresolvedConfig, environment);
  if (isHttpConfig(config)) {
    return createHttpTransport(config);
  }

  return new StdioClientTransport({
    command: config.command,
    args: config.args ?? [],
    env: config.env,
    cwd: config.cwd,
  });
}

export async function connectMCPClient(
  config: MCPServerConfig,
  purpose: 'introspector' | 'executor',
  environment: NodeJS.ProcessEnv = process.env
): Promise<Client> {
  const client = new Client(
    { name: `mcp-to-skill-${purpose}`, version: PACKAGE_VERSION },
    { capabilities: {} }
  );

  try {
    await client.connect(createMCPTransport(config, environment));
    return client;
  } catch (error) {
    await client.close().catch(() => undefined);
    const transport = config.type ?? 'stdio';
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not connect to MCP server "${config.name}" using ${transport}: ${detail}`,
      { cause: error }
    );
  }
}
