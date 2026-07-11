import { Command } from 'commander';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { MCPExecutor } from './executor';
import { compareTools, MCPSkillGenerator } from './generator';
import {
  extractCustomContent,
  skillNameFromServerName,
} from './generator/skill-md';
import { introspectMCPServer } from './mcp/client';
import {
  loadConfigDocument,
  loadToolSnapshot,
  parseToolCall,
  selectServerConfigs,
} from './mcp/config';
import type { MCPTool, ToolSnapshot } from './mcp/types';
import { PACKAGE_VERSION } from './version';

interface SelectionOptions {
  server?: string;
  all?: boolean;
}

interface GenerateCommandOptions extends SelectionOptions {
  mcpConfig: string;
  outputDir: string;
  tools?: string;
  allowEmpty?: boolean;
  json?: boolean;
}

function safeSkillOutputDirectory(root: string, serverName: string): string {
  const slug = skillNameFromServerName(serverName);
  const outputDir = path.resolve(root, slug);
  const relative = path.relative(root, outputDir);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`MCP server name "${serverName}" escapes the output directory`);
  }
  return outputDir;
}

async function generateSkills(options: GenerateCommandOptions): Promise<void> {
  const document = await loadConfigDocument(path.resolve(options.mcpConfig));
  const configs = selectServerConfigs(document, options);
  if (options.tools && configs.length !== 1) {
    throw new Error('--tools can only be used when generating one server');
  }

  const snapshot = options.tools
    ? await loadToolSnapshot(path.resolve(options.tools))
    : undefined;
  if (
    snapshot &&
    snapshot.serverName !== 'unknown' &&
    snapshot.serverName !== configs[0].name
  ) {
    throw new Error(
      `Tool snapshot is for "${snapshot.serverName}", not "${configs[0].name}"`
    );
  }

  const outputRoot = path.resolve(options.outputDir);
  const outputDirs = configs.map((config) =>
    configs.length > 1
      ? safeSkillOutputDirectory(outputRoot, config.name)
      : outputRoot
  );
  if (new Set(outputDirs).size !== outputDirs.length) {
    throw new Error('Multiple MCP server names resolve to the same output directory');
  }

  const results = [];
  for (const [index, config] of configs.entries()) {
    const outputDir = outputDirs[index];
    const generator = new MCPSkillGenerator(config, outputDir, {
      allowEmpty: options.allowEmpty,
      tools: snapshot?.tools,
      quiet: options.json,
    });
    results.push(await generator.generate());
  }

  if (options.json) {
    console.log(JSON.stringify(configs.length === 1 ? results[0] : results, null, 2));
  }
}

async function inspectServers(
  options: SelectionOptions & { config: string; output?: string }
): Promise<void> {
  const document = await loadConfigDocument(path.resolve(options.config));
  const configs = selectServerConfigs(document, options);
  const snapshots: ToolSnapshot[] = [];

  for (const config of configs) {
    const tools = await introspectMCPServer(config);
    snapshots.push({
      schemaVersion: 1,
      serverName: config.name,
      generatedAt: new Date().toISOString(),
      tools,
    });
  }

  const payload = configs.length === 1 ? snapshots[0] : snapshots;
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  if (options.output) {
    await fs.writeFile(path.resolve(options.output), json, 'utf-8');
  } else {
    process.stdout.write(json);
  }
}

async function refreshSkill(options: {
  skillDir: string;
  config?: string;
  tools?: string;
  allowEmpty?: boolean;
  json?: boolean;
}): Promise<void> {
  const skillDir = path.resolve(options.skillDir);
  const configPath = path.resolve(options.config ?? path.join(skillDir, 'mcp-config.json'));
  const document = await loadConfigDocument(configPath);
  const [config] = selectServerConfigs(document, {});
  const skillPath = path.join(skillDir, 'SKILL.md');
  const previousMarkdown = await fs.readFile(skillPath, 'utf-8');
  const customContent = extractCustomContent(previousMarkdown);
  let legacyBackup: string | undefined;
  if (customContent === undefined) {
    legacyBackup = path.join(skillDir, 'SKILL.md.previous');
    await fs.writeFile(legacyBackup, previousMarkdown, 'utf-8');
  }

  let previousTools: MCPTool[] = [];
  try {
    previousTools = (await loadToolSnapshot(path.join(skillDir, 'tools.json'))).tools;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('ENOENT')
    ) {
      throw error;
    }
  }

  const offlineSnapshot = options.tools
    ? await loadToolSnapshot(path.resolve(options.tools))
    : undefined;
  const generator = new MCPSkillGenerator(config, skillDir, {
    allowEmpty: options.allowEmpty,
    tools: offlineSnapshot?.tools,
    customContent,
    quiet: options.json,
  });
  const result = await generator.generate();
  const changes = compareTools(previousTools, result.snapshot.tools);
  const refreshResult = { ...result, changes, legacyBackup };

  if (options.json) {
    console.log(JSON.stringify(refreshResult, null, 2));
  } else {
    console.log(
      `Tool changes: +${changes.added.length} -${changes.removed.length} ~${changes.changed.length}`
    );
    if (legacyBackup) {
      console.warn(
        `The previous skill lacked managed custom-content markers and was preserved at ${legacyBackup}`
      );
    }
  }
}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export async function run(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  program
    .name('mcp-to-skill')
    .description('Convert MCP servers to Claude Skills with progressive disclosure')
    .version(PACKAGE_VERSION);

  program
    .command('generate')
    .description('Generate a Claude Skill from an MCP server configuration')
    .requiredOption('--mcp-config <path>', 'Path to MCP server configuration JSON')
    .requiredOption('--output-dir <path>', 'Output directory for generated skill')
    .option('--server <name>', 'Server to select from a multi-server config')
    .option('--all', 'Generate every server in a multi-server config')
    .option('--tools <path>', 'Use an offline tool snapshot instead of introspection')
    .option('--allow-empty', 'Allow generation with zero tools')
    .option('--json', 'Emit a machine-readable result')
    .action(generateSkills);

  program
    .command('inspect')
    .description('Introspect MCP tools and emit a reusable JSON snapshot')
    .requiredOption('--config <path>', 'Path to MCP server configuration JSON')
    .option('--server <name>', 'Server to select from a multi-server config')
    .option('--all', 'Inspect every server in a multi-server config')
    .option('--output <path>', 'Write the snapshot to a file')
    .action(inspectServers);

  program
    .command('refresh')
    .description('Refresh a generated skill while preserving custom instructions')
    .argument('<skill-dir>', 'Generated skill directory')
    .option('--config <path>', 'Override the stored MCP configuration')
    .option('--tools <path>', 'Use an offline tool snapshot instead of introspection')
    .option('--allow-empty', 'Allow refresh with zero tools')
    .option('--json', 'Emit a machine-readable result')
    .action((skillDir: string, options) => refreshSkill({ skillDir, ...options }));

  program
    .command('exec')
    .description('Execute MCP tools at runtime')
    .requiredOption('--config <path>', 'Path to mcp-config.json')
    .option('--server <name>', 'Server to select from a multi-server config')
    .option('--list', 'List available tools')
    .option('--describe <tool>', 'Get detailed schema for a tool')
    .option('--call <json>', 'Call a tool with JSON arguments')
    .option('--call-file <path>', 'Read a tool call from a JSON file')
    .option('--call-stdin', 'Read a tool call from standard input')
    .action(async (options: {
      config: string;
      server?: string;
      list?: boolean;
      describe?: string;
      call?: string;
      callFile?: string;
      callStdin?: boolean;
    }) => {
      const document = await loadConfigDocument(path.resolve(options.config));
      const [config] = selectServerConfigs(document, { server: options.server });
      const requestedActions = [
        options.list,
        options.describe !== undefined,
        options.call !== undefined,
        options.callFile !== undefined,
        options.callStdin,
      ].filter(Boolean).length;
      if (requestedActions !== 1) {
        throw new Error(
          'Choose exactly one of --list, --describe, --call, --call-file, or --call-stdin'
        );
      }
      const callJson = options.call
        ?? (options.callFile
          ? await fs.readFile(path.resolve(options.callFile), 'utf-8')
          : options.callStdin
            ? await readStandardInput()
            : undefined);

      const executor = new MCPExecutor(config);
      try {
        if (options.list) {
          console.log(JSON.stringify(await executor.listTools(), null, 2));
        } else if (options.describe) {
          const schema = await executor.describeTool(options.describe);
          if (!schema) throw new Error(`Tool not found: ${options.describe}`);
          console.log(JSON.stringify(schema, null, 2));
        } else if (callJson !== undefined) {
          const call = parseToolCall(callJson);
          const result = await executor.callTool(call.tool, call.arguments ?? {});
          console.log(JSON.stringify(result, null, 2));
        }
      } finally {
        await executor.close();
      }
    });

  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error(
      'Error:',
      error instanceof Error ? error.message : String(error)
    );
    process.exitCode = 1;
  }
}
