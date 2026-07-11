export interface MCPStdioConfig {
  name: string;
  description?: string;
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface MCPBearerAuthConfig {
  type: 'bearer';
  token: string;
}

export interface MCPOAuthClientCredentialsConfig {
  type: 'oauth-client-credentials';
  clientId: string;
  clientSecret: string;
  scope?: string;
}

export type MCPHttpAuthConfig =
  | MCPBearerAuthConfig
  | MCPOAuthClientCredentialsConfig;

export interface MCPHttpConfig {
  name: string;
  description?: string;
  type: 'http' | 'sse';
  url: string;
  headers?: Record<string, string>;
  auth?: MCPHttpAuthConfig;
}

export type MCPServerConfig = MCPStdioConfig | MCPHttpConfig;

export function isHttpConfig(
  config: MCPServerConfig
): config is MCPHttpConfig {
  return config.type === 'http' || config.type === 'sse';
}

export interface ClaudeDesktopConfig {
  mcpServers: Record<string, Omit<MCPServerConfig, 'name'>>;
}

export interface MCPConfigDocument {
  servers: Record<string, MCPServerConfig>;
  wrapped: boolean;
}

export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolSnapshot {
  schemaVersion: 1;
  serverName: string;
  generatedAt: string;
  tools: MCPTool[];
}

export interface ToolChanges {
  added: string[];
  removed: string[];
  changed: string[];
}
