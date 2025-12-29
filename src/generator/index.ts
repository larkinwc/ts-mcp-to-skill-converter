import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { introspectMCPServer } from '../mcp/client';
import type { MCPServerConfig, MCPStdioConfig, MCPHttpConfig, MCPTool, ClaudeDesktopConfig } from '../mcp/types';
import { generateSkillMd } from './skill-md';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the current package version
 */
async function getPackageVersion(): Promise<string> {
  const pkgPath = path.join(__dirname, '../package.json');
  const pkgContent = await fs.readFile(pkgPath, 'utf-8');
  const pkg = JSON.parse(pkgContent);
  return pkg.version ?? '0.1.0';
}

/**
 * Check if config is Claude Desktop format (has mcpServers wrapper)
 */
function isClaudeDesktopConfig(config: unknown): config is ClaudeDesktopConfig {
  return typeof config === 'object' && config !== null && 'mcpServers' in config;
}

/**
 * Parse config file and normalize to MCPServerConfig
 */
function parseConfig(rawConfig: unknown): MCPServerConfig {
  if (isClaudeDesktopConfig(rawConfig)) {
    // Claude Desktop format: { mcpServers: { "name": { ... } } }
    const serverNames = Object.keys(rawConfig.mcpServers);
    if (serverNames.length === 0) {
      throw new Error('No MCP servers found in config');
    }
    if (serverNames.length > 1) {
      console.warn(`Multiple servers found: ${serverNames.join(', ')}. Using first: ${serverNames[0]}`);
    }
    const serverName = serverNames[0];
    const serverConfig = rawConfig.mcpServers[serverName];
    return {
      name: serverName,
      ...serverConfig,
    } as MCPServerConfig;
  }

  // Direct format: { name, command, ... } or { name, url, ... }
  return rawConfig as MCPServerConfig;
}

/**
 * Get display string for server (command or URL)
 */
function getServerDisplay(config: MCPServerConfig): string {
  if ('url' in config) {
    return (config as MCPHttpConfig).url;
  }
  return (config as MCPStdioConfig).command ?? 'unknown';
}

/**
 * Main generator class that converts MCP server to Claude Skill.
 */
export class MCPSkillGenerator {
  private configPath: string;
  private outputDir: string;
  private config: MCPServerConfig | null = null;

  constructor(configPath: string, outputDir: string) {
    this.configPath = path.resolve(configPath);
    this.outputDir = path.resolve(outputDir);
  }

  async generate(): Promise<void> {
    // 1. Load and validate config
    const configContent = await fs.readFile(this.configPath, 'utf-8');
    const rawConfig = JSON.parse(configContent);
    this.config = parseConfig(rawConfig);
    const serverName = this.config.name ?? 'unnamed-mcp-server';
    const version = await getPackageVersion();

    console.log(`Generating skill for MCP server: ${serverName}`);

    // 2. Create output directory
    await fs.mkdir(this.outputDir, { recursive: true });

    // 3. Introspect MCP server
    console.log(`Introspecting MCP server: ${getServerDisplay(this.config)}`);
    let tools: MCPTool[];
    try {
      tools = await introspectMCPServer(this.config);
      console.log(`Found ${tools.length} tools`);
    } catch (error) {
      console.warn(
        `Warning: Could not introspect MCP server: ${error instanceof Error ? error.message : String(error)}`
      );
      console.warn('Using empty tool list. You may need to update SKILL.md manually.');
      tools = [];
    }

    // 4. Generate files
    await this.writeSkillMd(serverName, tools, version);
    await this.writeMcpConfig();

    this.printSummary(serverName, tools.length);
  }

  private async writeSkillMd(serverName: string, tools: MCPTool[], version: string): Promise<void> {
    const content = generateSkillMd(serverName, tools, version);
    const filePath = path.join(this.outputDir, 'SKILL.md');
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`  Generated: SKILL.md`);
  }

  private async writeMcpConfig(): Promise<void> {
    const filePath = path.join(this.outputDir, 'mcp-config.json');
    await fs.writeFile(filePath, JSON.stringify(this.config, null, 2), 'utf-8');
    console.log(`  Generated: mcp-config.json`);
  }

  private printSummary(serverName: string, toolCount: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('Skill generation complete!');
    console.log('='.repeat(60));
    console.log(`\nGenerated files in: ${this.outputDir}`);
    console.log('  - SKILL.md (instructions for Claude)');
    console.log('  - mcp-config.json (MCP server configuration)');

    console.log(`\nTo use this skill:`);
    console.log(`  cp -r ${this.outputDir} ~/.claude/skills/`);

    console.log(`\nContext savings:`);
    console.log(`  Before (MCP): All ${toolCount} tools preloaded (~${toolCount * 500} tokens)`);
    console.log(`  After (Skill): ~100 tokens until used`);
    if (toolCount > 0) {
      console.log(`  Reduction: ~${Math.round((1 - 100 / (toolCount * 500)) * 100)}%`);
    }
  }
}
