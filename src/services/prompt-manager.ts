/**
 * Prompt Manager - loads and interpolates prompt templates
 */

import { fs, path } from 'zx';
import { UATError, handlePromptError } from './error-handling.js';
import { MCP_AGENT_MAPPING } from '../session-manager.js';
import type { Authentication, PersonasConfig, DistributedConfig } from '../types/config.js';
import type { ActivityLogger } from '../types/activity-logger.js';

const FILE_WRITING_CONSTRAINT = `

<file_writing_rules>
**MANDATORY: All files you create or write MUST be inside the \`deliverables/\` or \`workspace/\` directories.**
- Use \`deliverables/\` for all reports, evidence, test results, and summaries
- Use \`workspace/\` for scratch files, tracking, and intermediate work
- NEVER write files to the repository root directory
- The \`save_deliverable\` MCP tool automatically writes to \`deliverables/\` — use it for all formal deliverables
</file_writing_rules>`;

interface PromptVariables {
  webUrl: string;
  MCP_SERVER?: string;
}

interface IncludeReplacement {
  placeholder: string;
  content: string;
}

async function buildLoginInstructions(authentication: Authentication, logger: ActivityLogger): Promise<string> {
  try {
    const loginInstructionsPath = path.join(import.meta.dirname, '..', '..', 'prompts', 'shared', 'login-instructions.txt');
    if (!await fs.pathExists(loginInstructionsPath)) {
      throw new UATError('Login instructions template not found', 'filesystem', false, { loginInstructionsPath });
    }
    const fullTemplate = await fs.readFile(loginInstructionsPath, 'utf8');
    const getSection = (content: string, sectionName: string): string => {
      const regex = new RegExp(`<!-- BEGIN:${sectionName} -->([\\s\\S]*?)<!-- END:${sectionName} -->`, 'g');
      const match = regex.exec(content);
      return match ? match[1]!.trim() : '';
    };
    const loginType = authentication.login_type?.toUpperCase();
    let loginInstructions = '';
    const commonSection = getSection(fullTemplate, 'COMMON');
    const authSection = loginType ? getSection(fullTemplate, loginType) : '';
    const verificationSection = getSection(fullTemplate, 'VERIFICATION');
    if (!commonSection && !authSection && !verificationSection) {
      logger.warn('Section markers not found, using full login instructions template');
      loginInstructions = fullTemplate;
    } else {
      loginInstructions = [commonSection, authSection, verificationSection].filter(s => s).join('\n\n');
    }
    let userInstructions = (authentication.login_flow ?? []).join('\n');
    if (authentication.credentials) {
      if (authentication.credentials.username) userInstructions = userInstructions.replace(/\$username/g, authentication.credentials.username);
      if (authentication.credentials.password) userInstructions = userInstructions.replace(/\$password/g, authentication.credentials.password);
      if (authentication.credentials.totp_secret) userInstructions = userInstructions.replace(/\$totp/g, `generated TOTP code using secret "${authentication.credentials.totp_secret}"`);
    }
    loginInstructions = loginInstructions.replace(/{{user_instructions}}/g, userInstructions);
    if (authentication.credentials?.totp_secret) {
      loginInstructions = loginInstructions.replace(/{{totp_secret}}/g, authentication.credentials.totp_secret);
    }
    return loginInstructions;
  } catch (error) {
    if (error instanceof UATError) throw error;
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new UATError(`Failed to build login instructions: ${errMsg}`, 'config', false, { originalError: errMsg });
  }
}

function buildPersonasContext(personas: PersonasConfig): string {
  const sections: string[] = ['## Test Personas'];
  for (const persona of personas.personas) {
    sections.push(`- **Role:** ${persona.role}`);
    sections.push(`  - Username: ${persona.username}`);
    sections.push(`  - Password: ${persona.password}`);
    if (persona.totp_secret) sections.push(`  - TOTP Secret: ${persona.totp_secret}`);
  }
  if (personas.role_hierarchy && personas.role_hierarchy.length > 0) {
    sections.push('\n## Role Hierarchy');
    const sorted = [...personas.role_hierarchy].sort((a, b) => b.level - a.level);
    for (const rh of sorted) {
      sections.push(`- **${rh.role}** (level ${rh.level})`);
    }
  }
  return sections.join('\n');
}

async function processIncludes(content: string, baseDir: string): Promise<string> {
  const includeRegex = /@include\(([^)]+)\)/g;
  const resolvedBase = path.resolve(baseDir);
  const replacements: IncludeReplacement[] = await Promise.all(
    Array.from(content.matchAll(includeRegex)).map(async (match) => {
      const includePath = path.resolve(baseDir, match[1]!);
      if (!includePath.startsWith(resolvedBase + path.sep) && includePath !== resolvedBase) {
        throw new UATError(`Path traversal detected in @include(): ${match[1]}`, 'prompt', false, { includePath, baseDir: resolvedBase });
      }
      const sharedContent = await fs.readFile(includePath, 'utf8');
      return { placeholder: match[0], content: sharedContent };
    })
  );
  for (const replacement of replacements) {
    content = content.replace(replacement.placeholder, replacement.content);
  }
  return content;
}

async function interpolateVariables(
  template: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null,
  logger: ActivityLogger
): Promise<string> {
  try {
    if (!template || typeof template !== 'string') {
      throw new UATError('Template must be a non-empty string', 'validation', false, {});
    }
    if (!variables || !variables.webUrl) {
      throw new UATError('Variables must include webUrl', 'validation', false, { variables: Object.keys(variables || {}) });
    }
    let result = template
      .replace(/{{WEB_URL}}/g, variables.webUrl)
      .replace(/{{MCP_SERVER}}/g, variables.MCP_SERVER || 'playwright-agent1');

    if (config) {
      const hasSkipRules = config.skip && config.skip.length > 0;
      const hasFocusRules = config.focus && config.focus.length > 0;
      if (!hasSkipRules && !hasFocusRules) {
        const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
        result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      } else {
        const skipRules = hasSkipRules ? config.skip!.map(r => `- ${r.description}`).join('\n') : 'None';
        const focusRules = hasFocusRules ? config.focus!.map(r => `- ${r.description}`).join('\n') : 'None';
        result = result.replace(/{{RULES_SKIP}}/g, skipRules).replace(/{{RULES_FOCUS}}/g, focusRules);
      }
      if (config.personas) {
        result = result.replace(/{{PERSONAS_CONFIG}}/g, buildPersonasContext(config.personas));
      } else {
        result = result.replace(/{{PERSONAS_CONFIG}}/g, 'No persona testing configuration was provided.');
      }
      if (config.authentication?.login_flow) {
        const loginInstructions = await buildLoginInstructions(config.authentication, logger);
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, loginInstructions);
      } else {
        result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
      }
      if (config.acceptanceCriteria && config.acceptanceCriteria.length > 0) {
        const acList = config.acceptanceCriteria.map(ac => `- **${ac.id}** [${ac.category}/${ac.priority}]: ${ac.description}\n  Expected: ${ac.expected_behavior}`).join('\n');
        result = result.replace(/{{ACCEPTANCE_CRITERIA}}/g, acList);
      } else {
        result = result.replace(/{{ACCEPTANCE_CRITERIA}}/g, 'No acceptance criteria provided.');
      }
    } else {
      const cleanRulesSection = '<rules>\nNo specific rules or focus areas provided for this test.\n</rules>';
      result = result.replace(/<rules>[\s\S]*?<\/rules>/g, cleanRulesSection);
      result = result.replace(/{{LOGIN_INSTRUCTIONS}}/g, '');
      result = result.replace(/{{PERSONAS_CONFIG}}/g, 'No persona testing configuration was provided.');
      result = result.replace(/{{ACCEPTANCE_CRITERIA}}/g, 'No acceptance criteria provided.');
    }

    const remainingPlaceholders = result.match(/\{\{[^}]+\}\}/g);
    if (remainingPlaceholders) {
      logger.warn(`Found unresolved placeholders in prompt: ${remainingPlaceholders.join(', ')}`);
    }
    result += FILE_WRITING_CONSTRAINT;
    return result;
  } catch (error) {
    if (error instanceof UATError) throw error;
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new UATError(`Variable interpolation failed: ${errMsg}`, 'prompt', false, { originalError: errMsg });
  }
}

export async function loadPrompt(
  promptName: string,
  variables: PromptVariables,
  config: DistributedConfig | null = null,
  pipelineTestingMode: boolean = false,
  logger: ActivityLogger
): Promise<string> {
  try {
    const baseDir = pipelineTestingMode ? 'prompts/pipeline-testing' : 'prompts';
    const promptsDir = path.join(import.meta.dirname, '..', '..', baseDir);
    const promptPath = path.join(promptsDir, `${promptName}.txt`);
    if (pipelineTestingMode) logger.info(`Using pipeline testing prompt: ${promptPath}`);
    if (!await fs.pathExists(promptPath)) {
      throw new UATError(`Prompt file not found: ${promptPath}`, 'prompt', false, { promptName, promptPath });
    }
    const enhancedVariables: PromptVariables = { ...variables };
    const mcpServer = MCP_AGENT_MAPPING[promptName as keyof typeof MCP_AGENT_MAPPING];
    if (mcpServer) {
      enhancedVariables.MCP_SERVER = mcpServer;
      logger.info(`Assigned ${promptName} -> ${enhancedVariables.MCP_SERVER}`);
    } else {
      enhancedVariables.MCP_SERVER = 'playwright-agent1';
      logger.warn(`Unknown agent ${promptName}, using fallback -> ${enhancedVariables.MCP_SERVER}`);
    }
    let template = await fs.readFile(promptPath, 'utf8');
    template = await processIncludes(template, promptsDir);
    return await interpolateVariables(template, enhancedVariables, config, logger);
  } catch (error) {
    if (error instanceof UATError) throw error;
    const promptError = handlePromptError(promptName, error as Error);
    throw promptError.error;
  }
}
