/**
 * Main generator class that converts MCP server to Claude Skill.
 */
export declare class MCPSkillGenerator {
    private configPath;
    private outputDir;
    private config;
    constructor(configPath: string, outputDir: string);
    generate(): Promise<void>;
    private writeSkillMd;
    private writeMcpConfig;
    private printSummary;
}
