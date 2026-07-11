import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const projectRoot = process.cwd();
const cliPath = path.join(projectRoot, 'src/index.ts');
const fixtureServer = path.join(projectRoot, 'tests/fixtures/stdio-server.ts');

function runCli(
  args: string[],
  options: { input?: string; env?: NodeJS.ProcessEnv } = {}
) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', cliPath, ...args],
    {
      cwd: projectRoot,
      encoding: 'utf-8',
      input: options.input,
      env: { ...process.env, ...options.env },
      maxBuffer: 1024 * 1024,
    }
  );
}

test('supports inspect, generation, safe calls, and refresh end to end', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcp-to-skill-test-'));
  const configPath = path.join(root, 'config.json');
  const snapshotPath = path.join(root, 'snapshot.json');
  const skillDir = path.join(root, 'skill');
  await writeFile(
    configPath,
    JSON.stringify({
      name: 'Fixture Server',
      command: process.execPath,
      args: ['--import', 'tsx', fixtureServer],
      env: { TEST_TOKEN: '${TEST_TOKEN}' },
    }),
    'utf-8'
  );

  const inspect = runCli([
    'inspect',
    '--config',
    configPath,
    '--output',
    snapshotPath,
  ], { env: { TEST_TOKEN: 'not-persisted' } });
  assert.equal(inspect.status, 0, inspect.stderr);
  const inspected = JSON.parse(await readFile(snapshotPath, 'utf-8'));
  assert.equal(inspected.serverName, 'Fixture Server');
  assert.equal(inspected.tools[0].name, 'echo');

  const generate = runCli([
    'generate',
    '--mcp-config',
    configPath,
    '--output-dir',
    skillDir,
    '--json',
  ], { env: { TEST_TOKEN: 'not-persisted' } });
  assert.equal(generate.status, 0, generate.stderr);
  assert.equal(JSON.parse(generate.stdout).toolCount, 1);
  const generatedConfig = await readFile(
    path.join(skillDir, 'mcp-config.json'),
    'utf-8'
  );
  assert.match(generatedConfig, /\$\{TEST_TOKEN\}/);
  assert.doesNotMatch(generatedConfig, /not-persisted/);

  const callValue = "apostrophe ' and a newline\nremain data";
  const callPath = path.join(root, 'call.json');
  const callJson = JSON.stringify({
    tool: 'echo',
    arguments: { text: callValue },
  });
  await writeFile(callPath, callJson, 'utf-8');

  const callFile = runCli([
    'exec',
    '--config',
    path.join(skillDir, 'mcp-config.json'),
    '--call-file',
    callPath,
  ], { env: { TEST_TOKEN: 'runtime-secret' } });
  assert.equal(callFile.status, 0, callFile.stderr);
  assert.equal(JSON.parse(callFile.stdout)[0].text, callValue);

  const callStdin = runCli([
    'exec',
    '--config',
    path.join(skillDir, 'mcp-config.json'),
    '--call-stdin',
  ], { input: callJson, env: { TEST_TOKEN: 'runtime-secret' } });
  assert.equal(callStdin.status, 0, callStdin.stderr);
  assert.equal(JSON.parse(callStdin.stdout)[0].text, callValue);

  const skillPath = path.join(skillDir, 'SKILL.md');
  const customized = (await readFile(skillPath, 'utf-8')).replace(
    'Add project-specific guidance here. This section is preserved by `mcp-to-skill refresh`.',
    'Always preserve this exact guidance.'
  );
  await writeFile(skillPath, customized, 'utf-8');
  const refresh = runCli([
    'refresh',
    skillDir,
    '--tools',
    snapshotPath,
    '--json',
  ], { env: { TEST_TOKEN: 'runtime-secret' } });
  assert.equal(refresh.status, 0, refresh.stderr);
  assert.deepEqual(JSON.parse(refresh.stdout).changes, {
    added: [],
    removed: [],
    changed: [],
  });
  assert.match(
    await readFile(skillPath, 'utf-8'),
    /Always preserve this exact guidance\./
  );
});

test('fails introspection by default and permits explicit empty generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcp-to-skill-failure-'));
  const configPath = path.join(root, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify({ name: 'broken', command: 'definitely-not-a-command' }),
    'utf-8'
  );

  const failed = runCli([
    'generate',
    '--mcp-config',
    configPath,
    '--output-dir',
    path.join(root, 'failed'),
  ]);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Could not connect to MCP server/);

  const allowed = runCli([
    'generate',
    '--mcp-config',
    configPath,
    '--output-dir',
    path.join(root, 'allowed'),
    '--allow-empty',
    '--json',
  ]);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).source, 'empty');
});

test('keeps multi-server output contained and rejects slug collisions', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'mcp-to-skill-multi-'));
  const configPath = path.join(root, 'config.json');
  const outputRoot = path.join(root, 'output');
  await writeFile(
    configPath,
    JSON.stringify({
      mcpServers: {
        '../../target': { command: 'missing-one' },
        'Café !!!': { command: 'missing-two' },
      },
    }),
    'utf-8'
  );

  const generated = runCli([
    'generate',
    '--mcp-config',
    configPath,
    '--output-dir',
    outputRoot,
    '--all',
    '--allow-empty',
    '--json',
  ]);
  assert.equal(generated.status, 0, generated.stderr);
  const results = JSON.parse(generated.stdout);
  assert.deepEqual(
    results.map((result: { outputDir: string }) => result.outputDir).sort(),
    [path.join(outputRoot, 'cafe'), path.join(outputRoot, 'target')]
  );
  for (const result of results) {
    const relative = path.relative(outputRoot, result.outputDir);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
  }

  const collisionPath = path.join(root, 'collision.json');
  await writeFile(
    collisionPath,
    JSON.stringify({
      mcpServers: {
        'A B': { command: 'missing-one' },
        'a-b': { command: 'missing-two' },
      },
    }),
    'utf-8'
  );
  const collision = runCli([
    'generate',
    '--mcp-config',
    collisionPath,
    '--output-dir',
    path.join(root, 'collision-output'),
    '--all',
    '--allow-empty',
  ]);
  assert.equal(collision.status, 1);
  assert.match(collision.stderr, /same output directory/);
});

test('reports the package version in source mode', () => {
  const result = runCli(['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '0.3.0');
});
