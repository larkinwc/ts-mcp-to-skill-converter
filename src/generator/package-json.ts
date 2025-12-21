/**
 * Generate package.json for the generated skill.
 * This is used when rebuilding the executor from source.
 */
export function generatePackageJson(serverName: string): object {
  return {
    name: `skill-${serverName}`,
    version: '1.0.0',
    type: 'module',
    description: `Claude Skill wrapper for ${serverName} MCP server`,
    scripts: {
      build: 'bun build executor.ts --compile --outfile executor',
      'build:all':
        'bun build executor.ts --compile --target=bun-linux-x64 --outfile executor-linux-x64 && ' +
        'bun build executor.ts --compile --target=bun-darwin-arm64 --outfile executor-darwin-arm64 && ' +
        'bun build executor.ts --compile --target=bun-darwin-x64 --outfile executor-darwin-x64 && ' +
        'bun build executor.ts --compile --target=bun-windows-x64 --outfile executor-windows-x64.exe',
    },
    dependencies: {
      '@modelcontextprotocol/sdk': '^1.0.0',
      zod: '^3.25.0',
    },
  };
}
