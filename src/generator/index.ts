import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { introspectMCPServer } from '../mcp/client.js';
import type { MCPServerConfig, MCPTool, CompileTarget } from '../mcp/types.js';
import { generateSkillMd } from './skill-md.js';
import { generateExecutorTs } from './executor.js';
import { generatePackageJson } from './package-json.js';

const execAsync = promisify(exec);

interface CompileTargetInfo {
  bunTarget: string;
  outputName: string;
}

const COMPILE_TARGETS: Record<string, CompileTargetInfo> = {
  'linux-x64': { bunTarget: 'bun-linux-x64', outputName: 'executor-linux-x64' },
  'darwin-arm64': {
    bunTarget: 'bun-darwin-arm64',
    outputName: 'executor-darwin-arm64',
  },
  'darwin-x64': {
    bunTarget: 'bun-darwin-x64',
    outputName: 'executor-darwin-x64',
  },
  'windows-x64': {
    bunTarget: 'bun-windows-x64',
    outputName: 'executor-windows-x64.exe',
  },
};

/**
 * Main generator class that converts MCP server to Claude Skill.
 */
export class MCPSkillGenerator {
  private configPath: string;
  private outputDir: string;
  private config: MCPServerConfig | null = null;
  private target: CompileTarget;

  constructor(configPath: string, outputDir: string, target: CompileTarget = 'current') {
    this.configPath = path.resolve(configPath);
    this.outputDir = path.resolve(outputDir);
    this.target = target;
  }

  async generate(): Promise<void> {
    // 1. Load and validate config
    const configContent = await fs.readFile(this.configPath, 'utf-8');
    this.config = JSON.parse(configContent) as MCPServerConfig;
    const serverName = this.config.name ?? 'unnamed-mcp-server';

    console.log(`Generating skill for MCP server: ${serverName}`);

    // 2. Create output directory
    await fs.mkdir(this.outputDir, { recursive: true });

    // 3. Introspect MCP server
    console.log(`Introspecting MCP server: ${this.config.command}`);
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
    await this.writeSkillMd(serverName, tools);
    await this.writeExecutorTs();
    await this.writeMcpConfig();
    await this.writePackageJson(serverName);

    // 5. Compile executor
    await this.compileExecutor();

    this.printSummary(serverName, tools.length);
  }

  private async writeSkillMd(serverName: string, tools: MCPTool[]): Promise<void> {
    const content = generateSkillMd(serverName, tools);
    const filePath = path.join(this.outputDir, 'SKILL.md');
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`  Generated: SKILL.md`);
  }

  private async writeExecutorTs(): Promise<void> {
    const content = generateExecutorTs();
    const filePath = path.join(this.outputDir, 'executor.ts');
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`  Generated: executor.ts`);
  }

  private async writeMcpConfig(): Promise<void> {
    const filePath = path.join(this.outputDir, 'mcp-config.json');
    await fs.writeFile(filePath, JSON.stringify(this.config, null, 2), 'utf-8');
    console.log(`  Generated: mcp-config.json`);
  }

  private async writePackageJson(serverName: string): Promise<void> {
    const content = generatePackageJson(serverName);
    const filePath = path.join(this.outputDir, 'package.json');
    await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
    console.log(`  Generated: package.json`);
  }

  private async checkBunAvailable(): Promise<boolean> {
    try {
      await execAsync('bun --version');
      return true;
    } catch {
      return false;
    }
  }

  private async compileExecutor(): Promise<void> {
    console.log('\nCompiling executor...');

    // Check if Bun is available
    const bunAvailable = await this.checkBunAvailable();
    if (!bunAvailable) {
      console.warn('\n  Warning: Bun is not installed. Skipping binary compilation.');
      console.warn('  The executor.ts source file has been generated.');
      console.warn('  To compile to a standalone binary, install Bun:');
      console.warn('    curl -fsSL https://bun.sh/install | bash');
      console.warn('  Then run in the output directory:');
      console.warn('    bun build executor.ts --compile --outfile executor');
      return;
    }

    const executorPath = path.join(this.outputDir, 'executor.ts');
    const targets = this.getTargetsToCompile();

    for (const [targetName, info] of Object.entries(targets)) {
      const outputPath = path.join(this.outputDir, info.outputName);
      const command = `bun build "${executorPath}" --compile --target=${info.bunTarget} --outfile "${outputPath}"`;

      try {
        console.log(`  Compiling for ${targetName}...`);
        await execAsync(command, { cwd: this.outputDir });
        console.log(`  Compiled: ${info.outputName}`);
      } catch (error) {
        console.error(
          `  Error compiling for ${targetName}: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
    }
  }

  private getTargetsToCompile(): Record<string, CompileTargetInfo> {
    if (this.target === 'all') {
      return COMPILE_TARGETS;
    }

    if (this.target === 'current') {
      const currentTarget = this.detectCurrentPlatform();
      return {
        [currentTarget]: {
          ...COMPILE_TARGETS[currentTarget],
          outputName: 'executor', // Use simple name for current platform
        },
      };
    }

    // Specific target
    if (COMPILE_TARGETS[this.target]) {
      return { [this.target]: COMPILE_TARGETS[this.target] };
    }

    throw new Error(`Unknown target: ${this.target}`);
  }

  private detectCurrentPlatform(): string {
    const platform = process.platform;
    const arch = process.arch;

    if (platform === 'darwin') {
      return arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    } else if (platform === 'linux') {
      return 'linux-x64';
    } else if (platform === 'win32') {
      return 'windows-x64';
    }

    // Default to linux-x64
    return 'linux-x64';
  }

  private printSummary(serverName: string, toolCount: number): void {
    console.log('\n' + '='.repeat(60));
    console.log('Skill generation complete!');
    console.log('='.repeat(60));
    console.log(`\nGenerated files in: ${this.outputDir}`);
    console.log('  - SKILL.md (instructions for Claude)');
    console.log('  - executor.ts (source code)');
    console.log('  - executor (compiled binary)');
    console.log('  - mcp-config.json (MCP server configuration)');
    console.log('  - package.json (for rebuilding)');

    console.log(`\nTo use this skill:`);
    console.log(`1. Copy to Claude skills directory:`);
    console.log(`   cp -r ${this.outputDir} ~/.claude/skills/`);
    console.log(`\n2. Claude will discover it automatically`);

    console.log(`\nContext savings:`);
    console.log(`  Before (MCP): All ${toolCount} tools preloaded (~${toolCount * 500} tokens)`);
    console.log(`  After (Skill): ~100 tokens until used`);
    if (toolCount > 0) {
      console.log(`  Reduction: ~${Math.round((1 - 100 / (toolCount * 500)) * 100)}%`);
    }
  }
}
