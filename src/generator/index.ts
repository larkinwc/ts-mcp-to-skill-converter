import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { introspectMCPServer } from '../mcp/client';
import {
  findLiteralSecretWarnings,
  makeConfigPortable,
} from '../mcp/config';
import type {
  MCPServerConfig,
  MCPTool,
  ToolChanges,
  ToolSnapshot,
} from '../mcp/types';
import { PACKAGE_VERSION } from '../version';
import { generateSkillMd } from './skill-md';

export interface GenerateOptions {
  allowEmpty?: boolean;
  tools?: MCPTool[];
  customContent?: string;
  quiet?: boolean;
}

export interface GenerateResult {
  serverName: string;
  outputDir: string;
  toolCount: number;
  source: 'live' | 'snapshot' | 'empty';
  warnings: string[];
  snapshot: ToolSnapshot;
}

export class MCPSkillGenerator {
  private readonly outputDir: string;

  constructor(
    private readonly config: MCPServerConfig,
    outputDir: string,
    private readonly options: GenerateOptions = {}
  ) {
    this.outputDir = path.resolve(outputDir);
  }

  async generate(): Promise<GenerateResult> {
    const warnings: string[] = [];
    let tools = this.options.tools;
    let source: GenerateResult['source'] = tools ? 'snapshot' : 'live';

    if (!this.options.quiet) {
      console.log(`Generating skill for MCP server: ${this.config.name}`);
    }

    if (!tools) {
      try {
        tools = await introspectMCPServer(this.config);
      } catch (error) {
        if (!this.options.allowEmpty) throw error;
        const message =
          `Introspection failed; generating an empty skill because --allow-empty was supplied: ` +
          (error instanceof Error ? error.message : String(error));
        warnings.push(message);
        tools = [];
        source = 'empty';
      }
    }

    if (tools.length === 0 && !this.options.allowEmpty) {
      throw new Error(
        `MCP server "${this.config.name}" exposed no tools. Use --allow-empty to generate an empty skill intentionally.`
      );
    }

    const portableConfig = makeConfigPortable(this.config);
    const literalSecrets = findLiteralSecretWarnings(portableConfig);
    if (literalSecrets.length > 0) {
      warnings.push(
        `Generated configuration contains literal secret-like values (${literalSecrets.join(', ')}). Replace them with environment references such as \${MCP_TOKEN} before committing the skill.`
      );
    }

    const snapshot: ToolSnapshot = {
      schemaVersion: 1,
      serverName: this.config.name,
      generatedAt: new Date().toISOString(),
      tools,
    };

    await fs.mkdir(this.outputDir, { recursive: true });
    await Promise.all([
      fs.writeFile(
        path.join(this.outputDir, 'SKILL.md'),
        generateSkillMd(
          this.config.name,
          tools,
          PACKAGE_VERSION,
          this.options.customContent
        ),
        'utf-8'
      ),
      fs.writeFile(
        path.join(this.outputDir, 'mcp-config.json'),
        `${JSON.stringify(portableConfig, null, 2)}\n`,
        'utf-8'
      ),
      fs.writeFile(
        path.join(this.outputDir, 'tools.json'),
        `${JSON.stringify(snapshot, null, 2)}\n`,
        'utf-8'
      ),
    ]);

    if (!this.options.quiet) {
      this.printSummary(tools.length, warnings);
    }

    return {
      serverName: this.config.name,
      outputDir: this.outputDir,
      toolCount: tools.length,
      source,
      warnings,
      snapshot,
    };
  }

  private printSummary(toolCount: number, warnings: string[]): void {
    console.log(`Generated ${toolCount} tools in ${this.outputDir}`);
    console.log('  - SKILL.md');
    console.log('  - mcp-config.json');
    console.log('  - tools.json');
    for (const warning of warnings) console.warn(`Warning: ${warning}`);
  }
}

export function compareTools(
  previous: MCPTool[],
  current: MCPTool[]
): ToolChanges {
  const previousByName = new Map(previous.map((tool) => [tool.name, tool]));
  const currentByName = new Map(current.map((tool) => [tool.name, tool]));
  const added = [...currentByName.keys()]
    .filter((name) => !previousByName.has(name))
    .sort();
  const removed = [...previousByName.keys()]
    .filter((name) => !currentByName.has(name))
    .sort();
  const changed = [...currentByName.entries()]
    .filter(([name, tool]) => {
      const prior = previousByName.get(name);
      return prior !== undefined && JSON.stringify(prior) !== JSON.stringify(tool);
    })
    .map(([name]) => name)
    .sort();
  return { added, removed, changed };
}
