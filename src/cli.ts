import { Command } from 'commander';
import { MCPSkillGenerator } from './generator/index.js';
import type { CompileTarget } from './mcp/types.js';

const VALID_TARGETS = [
  'current',
  'linux-x64',
  'darwin-arm64',
  'darwin-x64',
  'windows-x64',
  'all',
] as const;

export async function run(): Promise<void> {
  const program = new Command();

  program
    .name('mcp-to-skill')
    .description(
      'Convert MCP server to Claude Skill with progressive disclosure'
    )
    .requiredOption(
      '--mcp-config <path>',
      'Path to MCP server configuration JSON'
    )
    .requiredOption('--output-dir <path>', 'Output directory for generated skill')
    .option(
      '--target <target>',
      `Compile target: ${VALID_TARGETS.join(', ')}`,
      'current'
    )
    .parse();

  const options = program.opts<{
    mcpConfig: string;
    outputDir: string;
    target: string;
  }>();

  // Validate target
  if (!VALID_TARGETS.includes(options.target as CompileTarget)) {
    console.error(`Invalid target: ${options.target}`);
    console.error(`Valid targets: ${VALID_TARGETS.join(', ')}`);
    process.exit(1);
  }

  const generator = new MCPSkillGenerator(
    options.mcpConfig,
    options.outputDir,
    options.target as CompileTarget
  );

  try {
    await generator.generate();
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}
