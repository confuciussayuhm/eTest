import { createRequire } from 'module';
import { fs } from 'zx';
import yaml from 'js-yaml';
import { Ajv, type ValidateFunction, type ErrorObject } from 'ajv';
import type { FormatsPlugin } from 'ajv-formats';
import { UATError } from './services/error-handling.js';
import { ErrorCode } from './types/errors.js';
import type {
  Config,
  Rule,
  Authentication,
  PersonasConfig,
  DistributedConfig,
} from './types/config.js';

// Handle ESM/CJS interop for ajv-formats using require
const require = createRequire(import.meta.url);
const addFormats: FormatsPlugin = require('ajv-formats');

const ajv = new Ajv({ allErrors: true, verbose: true });
addFormats(ajv);

let configSchema: object;
let validateSchema: ValidateFunction;

try {
  const schemaPath = new URL('../configs/config-schema.json', import.meta.url);
  const schemaContent = await fs.readFile(schemaPath, 'utf8');
  configSchema = JSON.parse(schemaContent) as object;
  validateSchema = ajv.compile(configSchema);
} catch (error) {
  const errMsg = error instanceof Error ? error.message : String(error);
  throw new UATError(
    `Failed to load configuration schema: ${errMsg}`,
    'config',
    false,
    { schemaPath: '../configs/config-schema.json', originalError: errMsg }
  );
}

const DANGEROUS_PATTERNS: RegExp[] = [
  /\.\.\//, // Path traversal
  /[<>]/, // HTML/XML injection
  /javascript:/i, // JavaScript URLs
  /data:/i, // Data URLs
  /file:/i, // File URLs
];

/**
 * Format a single AJV error into a human-readable message.
 * Translates AJV error keywords into plain English descriptions.
 */
function formatAjvError(error: ErrorObject): string {
  const path = error.instancePath || 'root';
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case 'required': {
      const missingProperty = params.missingProperty as string;
      return `Missing required field: "${missingProperty}" at ${path || 'root'}`;
    }

    case 'type': {
      const expectedType = params.type as string;
      return `Invalid type at ${path}: expected ${expectedType}`;
    }

    case 'enum': {
      const allowedValues = params.allowedValues as unknown[];
      const formattedValues = allowedValues.map((v) => `"${v}"`).join(', ');
      return `Invalid value at ${path}: must be one of [${formattedValues}]`;
    }

    case 'additionalProperties': {
      const additionalProperty = params.additionalProperty as string;
      return `Unknown field at ${path}: "${additionalProperty}" is not allowed`;
    }

    case 'minLength': {
      const limit = params.limit as number;
      return `Value at ${path} is too short: must have at least ${limit} character(s)`;
    }

    case 'maxLength': {
      const limit = params.limit as number;
      return `Value at ${path} is too long: must have at most ${limit} character(s)`;
    }

    case 'minimum': {
      const limit = params.limit as number;
      return `Value at ${path} is too small: must be >= ${limit}`;
    }

    case 'maximum': {
      const limit = params.limit as number;
      return `Value at ${path} is too large: must be <= ${limit}`;
    }

    case 'minItems': {
      const limit = params.limit as number;
      return `Array at ${path} has too few items: must have at least ${limit} item(s)`;
    }

    case 'maxItems': {
      const limit = params.limit as number;
      return `Array at ${path} has too many items: must have at most ${limit} item(s)`;
    }

    case 'pattern': {
      const pattern = params.pattern as string;
      return `Value at ${path} does not match required pattern: ${pattern}`;
    }

    case 'format': {
      const format = params.format as string;
      return `Value at ${path} must be a valid ${format}`;
    }

    case 'const': {
      const allowedValue = params.allowedValue as unknown;
      return `Value at ${path} must be exactly "${allowedValue}"`;
    }

    case 'oneOf': {
      return `Value at ${path} must match exactly one schema (matched ${params.passingSchemas ?? 0})`;
    }

    case 'anyOf': {
      return `Value at ${path} must match at least one of the allowed schemas`;
    }

    case 'not': {
      return `Value at ${path} matches a schema it should not match`;
    }

    case 'if': {
      return `Value at ${path} does not satisfy conditional schema requirements`;
    }

    case 'uniqueItems': {
      const i = params.i as number;
      const j = params.j as number;
      return `Array at ${path} contains duplicate items at positions ${j} and ${i}`;
    }

    case 'propertyNames': {
      const propertyName = params.propertyName as string;
      return `Invalid property name at ${path}: "${propertyName}" does not match naming requirements`;
    }

    case 'dependencies':
    case 'dependentRequired': {
      const property = params.property as string;
      const missingProperty = params.missingProperty as string;
      return `Missing dependent field at ${path}: "${missingProperty}" is required when "${property}" is present`;
    }

    default: {
      // Fallback for any unhandled keywords - use AJV's message if available
      const message = error.message || `validation failed for keyword "${error.keyword}"`;
      return `${path}: ${message}`;
    }
  }
}

/**
 * Format all AJV errors into a list of human-readable messages.
 * Returns an array of formatted error strings.
 */
function formatAjvErrors(errors: ErrorObject[]): string[] {
  return errors.map(formatAjvError);
}

export const parseConfig = async (configPath: string): Promise<Config> => {
  try {
    // 1. Verify file exists
    if (!(await fs.pathExists(configPath))) {
      throw new UATError(
        `Configuration file not found: ${configPath}`,
        'config',
        false,
        { configPath },
        ErrorCode.CONFIG_NOT_FOUND
      );
    }

    // 2. Check file size
    const stats = await fs.stat(configPath);
    const maxFileSize = 1024 * 1024; // 1MB
    if (stats.size > maxFileSize) {
      throw new UATError(
        `Configuration file too large: ${stats.size} bytes (maximum: ${maxFileSize} bytes)`,
        'config',
        false,
        { configPath, fileSize: stats.size, maxFileSize },
        ErrorCode.CONFIG_VALIDATION_FAILED
      );
    }

    // 3. Read and check for empty content
    const configContent = await fs.readFile(configPath, 'utf8');

    if (!configContent.trim()) {
      throw new UATError(
        'Configuration file is empty',
        'config',
        false,
        { configPath },
        ErrorCode.CONFIG_VALIDATION_FAILED
      );
    }

    // 4. Parse YAML with safe schema
    let config: unknown;
    try {
      config = yaml.load(configContent, {
        schema: yaml.FAILSAFE_SCHEMA, // Only basic YAML types, no JS evaluation
        json: false, // Don't allow JSON-specific syntax
        filename: configPath,
      });
    } catch (yamlError) {
      const errMsg = yamlError instanceof Error ? yamlError.message : String(yamlError);
      throw new UATError(
        `YAML parsing failed: ${errMsg}`,
        'config',
        false,
        { configPath, originalError: errMsg },
        ErrorCode.CONFIG_PARSE_ERROR
      );
    }

    // 5. Guard against null/undefined parse result
    if (config === null || config === undefined) {
      throw new UATError(
        'Configuration file resulted in null/undefined after parsing',
        'config',
        false,
        { configPath },
        ErrorCode.CONFIG_PARSE_ERROR
      );
    }

    // 6. Validate schema, security rules, and return
    validateConfig(config as Config);

    return config as Config;
  } catch (error) {
    // UATError instances are already well-formatted, re-throw as-is
    if (error instanceof UATError) {
      throw error;
    }
    const errMsg = error instanceof Error ? error.message : String(error);
    throw new UATError(
      `Failed to parse configuration file '${configPath}': ${errMsg}`,
      'config',
      false,
      { configPath, originalError: errMsg },
      ErrorCode.CONFIG_PARSE_ERROR
    );
  }
};

const validateConfig = (config: Config): void => {
  if (!config || typeof config !== 'object') {
    throw new UATError(
      'Configuration must be a valid object',
      'config',
      false,
      {},
      ErrorCode.CONFIG_VALIDATION_FAILED
    );
  }

  if (Array.isArray(config)) {
    throw new UATError(
      'Configuration must be an object, not an array',
      'config',
      false,
      {},
      ErrorCode.CONFIG_VALIDATION_FAILED
    );
  }

  const isValid = validateSchema(config);
  if (!isValid) {
    const errors = validateSchema.errors || [];
    const errorMessages = formatAjvErrors(errors);
    throw new UATError(
      `Configuration validation failed:\n  - ${errorMessages.join('\n  - ')}`,
      'config',
      false,
      { validationErrors: errorMessages },
      ErrorCode.CONFIG_VALIDATION_FAILED
    );
  }

  performSecurityValidation(config);

  // Warn if configuration is minimal
  if (!config.rules && !config.authentication) {
    console.warn(
      'Warning: Configuration file contains no rules or authentication. The UAT will run without any scoping restrictions or login capabilities.'
    );
  }
};

const performSecurityValidation = (config: Config): void => {
  if (config.authentication) {
    const auth = config.authentication;

    // Check login_url for dangerous patterns (AJV's "uri" format allows javascript: per RFC 3986)
    if (auth.login_url) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(auth.login_url)) {
          throw new UATError(
            `authentication.login_url contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'login_url', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED
          );
        }
      }
    }

    if (auth.credentials) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(auth.credentials.username)) {
          throw new UATError(
            `authentication.credentials.username contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'credentials.username', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED
          );
        }
        if (pattern.test(auth.credentials.password)) {
          throw new UATError(
            `authentication.credentials.password contains potentially dangerous pattern: ${pattern.source}`,
            'config',
            false,
            { field: 'credentials.password', pattern: pattern.source },
            ErrorCode.CONFIG_VALIDATION_FAILED
          );
        }
      }
    }

    if (auth.login_flow) {
      auth.login_flow.forEach((step, index) => {
        for (const pattern of DANGEROUS_PATTERNS) {
          if (pattern.test(step)) {
            throw new UATError(
              `authentication.login_flow[${index}] contains potentially dangerous pattern: ${pattern.source}`,
              'config',
              false,
              { field: `login_flow[${index}]`, pattern: pattern.source },
              ErrorCode.CONFIG_VALIDATION_FAILED
            );
          }
        }
      });
    }
  }

  if (config.personas) {
    validatePersonasSecurity(config.personas);
  }

  if (config.rules) {
    validateRulesSecurity(config.rules.skip, 'skip');
    validateRulesSecurity(config.rules.focus, 'focus');

    checkForDuplicates(config.rules.skip || [], 'skip');
    checkForDuplicates(config.rules.focus || [], 'focus');
    checkForConflicts(config.rules.skip, config.rules.focus);
  }
};

const validatePersonasSecurity = (personas: PersonasConfig): void => {
  if (!personas.personas) return;

  personas.personas.forEach((persona, index) => {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(persona.username)) {
        throw new UATError(
          `personas.personas[${index}].username contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `personas[${index}].username`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      if (pattern.test(persona.password)) {
        throw new UATError(
          `personas.personas[${index}].password contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `personas[${index}].password`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      if (pattern.test(persona.role)) {
        throw new UATError(
          `personas.personas[${index}].role contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `personas[${index}].role`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
    }
  });
};

const validateRulesSecurity = (rules: Rule[] | undefined, ruleType: string): void => {
  if (!rules) return;

  rules.forEach((rule, index) => {
    for (const pattern of DANGEROUS_PATTERNS) {
      if (pattern.test(rule.url_path)) {
        throw new UATError(
          `rules.${ruleType}[${index}].url_path contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `rules.${ruleType}[${index}].url_path`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      if (pattern.test(rule.description)) {
        throw new UATError(
          `rules.${ruleType}[${index}].description contains potentially dangerous pattern: ${pattern.source}`,
          'config',
          false,
          { field: `rules.${ruleType}[${index}].description`, pattern: pattern.source },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
    }

    validateRuleTypeSpecific(rule, ruleType, index);
  });
};

const validateRuleTypeSpecific = (rule: Rule, ruleType: string, index: number): void => {
  const field = `rules.${ruleType}[${index}].url_path`;

  switch (rule.type) {
    case 'path':
      if (!rule.url_path.startsWith('/')) {
        throw new UATError(
          `${field} for type 'path' must start with '/'`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      break;

    case 'subdomain':
    case 'domain':
      // Basic domain validation - no slashes allowed
      if (rule.url_path.includes('/')) {
        throw new UATError(
          `${field} for type '${rule.type}' cannot contain '/' characters`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      // Must contain at least one dot for domains
      if (rule.type === 'domain' && !rule.url_path.includes('.')) {
        throw new UATError(
          `${field} for type 'domain' must be a valid domain name`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      break;

    case 'method': {
      const allowedMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
      if (!allowedMethods.includes(rule.url_path.toUpperCase())) {
        throw new UATError(
          `${field} for type 'method' must be one of: ${allowedMethods.join(', ')}`,
          'config',
          false,
          { field, ruleType: rule.type, allowedMethods },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      break;
    }

    case 'header':
      if (!rule.url_path.match(/^[a-zA-Z0-9\-_]+$/)) {
        throw new UATError(
          `${field} for type 'header' must be a valid header name (alphanumeric, hyphens, underscores only)`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      break;

    case 'parameter':
      if (!rule.url_path.match(/^[a-zA-Z0-9\-_]+$/)) {
        throw new UATError(
          `${field} for type 'parameter' must be a valid parameter name (alphanumeric, hyphens, underscores only)`,
          'config',
          false,
          { field, ruleType: rule.type },
          ErrorCode.CONFIG_VALIDATION_FAILED
        );
      }
      break;
  }
};

const checkForDuplicates = (rules: Rule[], ruleType: string): void => {
  const seen = new Set<string>();
  rules.forEach((rule, index) => {
    const key = `${rule.type}:${rule.url_path}`;
    if (seen.has(key)) {
      throw new UATError(
        `Duplicate rule found in rules.${ruleType}[${index}]: ${rule.type} '${rule.url_path}'`,
        'config',
        false,
        { field: `rules.${ruleType}[${index}]`, ruleType: rule.type, urlPath: rule.url_path },
        ErrorCode.CONFIG_VALIDATION_FAILED
      );
    }
    seen.add(key);
  });
};

const checkForConflicts = (skipRules: Rule[] = [], focusRules: Rule[] = []): void => {
  const skipSet = new Set(skipRules.map((rule) => `${rule.type}:${rule.url_path}`));

  focusRules.forEach((rule, index) => {
    const key = `${rule.type}:${rule.url_path}`;
    if (skipSet.has(key)) {
      throw new UATError(
        `Conflicting rule found: rules.focus[${index}] '${rule.url_path}' also exists in rules.skip`,
        'config',
        false,
        { field: `rules.focus[${index}]`, urlPath: rule.url_path },
        ErrorCode.CONFIG_VALIDATION_FAILED
      );
    }
  });
};

const sanitizeRule = (rule: Rule): Rule => {
  return {
    description: rule.description.trim(),
    type: rule.type.toLowerCase().trim() as Rule['type'],
    url_path: rule.url_path.trim(),
  };
};

const sanitizeAuthentication = (auth: Authentication): Authentication => {
  return {
    login_type: auth.login_type.toLowerCase().trim() as Authentication['login_type'],
    login_url: auth.login_url.trim(),
    credentials: {
      username: auth.credentials.username.trim(),
      password: auth.credentials.password,
      ...(auth.credentials.totp_secret && { totp_secret: auth.credentials.totp_secret.trim() }),
    },
    ...(auth.login_flow && { login_flow: auth.login_flow.map((step) => step.trim()) }),
    success_condition: {
      type: auth.success_condition.type.toLowerCase().trim() as Authentication['success_condition']['type'],
      value: auth.success_condition.value.trim(),
    },
  };
};

const sanitizePersonas = (personas: PersonasConfig): PersonasConfig => {
  return {
    personas: personas.personas.map((p) => ({
      role: p.role.trim(),
      username: p.username.trim(),
      password: p.password,
      ...(p.totp_secret && { totp_secret: p.totp_secret.trim() }),
    })),
    ...(personas.role_hierarchy && {
      role_hierarchy: personas.role_hierarchy.map((rh) => ({
        role: rh.role.trim(),
        level: rh.level,
      })),
    }),
  };
};

export const distributeConfig = (config: Config | null): DistributedConfig => {
  const skip = config?.rules?.skip || [];
  const focus = config?.rules?.focus || [];
  const authentication = config?.authentication || null;
  const personas = config?.personas || null;
  const acceptanceCriteria = config?.acceptance_criteria || [];
  const environment = config?.environment || null;
  const regression = config?.regression || null;

  return {
    skip: skip.map(sanitizeRule),
    focus: focus.map(sanitizeRule),
    authentication: authentication ? sanitizeAuthentication(authentication) : null,
    personas: personas ? sanitizePersonas(personas) : null,
    acceptanceCriteria,
    environment,
    regression,
  };
};
