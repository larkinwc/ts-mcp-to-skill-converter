/**
 * MCP Server Configuration
 */
export interface MCPServerConfig {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * MCP Tool definition
 */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Target platform for compilation
 */
export type CompileTarget =
  | 'linux-x64'
  | 'darwin-arm64'
  | 'darwin-x64'
  | 'windows-x64'
  | 'all'
  | 'current';

/**
 * CLI Options
 */
export interface CLIOptions {
  mcpConfig: string;
  outputDir: string;
  target?: CompileTarget;
}
