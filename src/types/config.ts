/**
 * UAT Configuration type definitions
 */

export type RuleType = 'path' | 'subdomain' | 'domain' | 'method' | 'header' | 'parameter';

export interface Rule {
  description: string;
  type: RuleType;
  url_path: string;
}

export interface Rules {
  skip?: Rule[];
  focus?: Rule[];
}

export type LoginType = 'form' | 'sso' | 'api' | 'basic';

export interface SuccessCondition {
  type: 'url' | 'url_contains' | 'cookie' | 'element' | 'redirect';
  value: string;
}

export interface Credentials {
  username: string;
  password: string;
  totp_secret?: string;
}

export interface Authentication {
  login_type: LoginType;
  login_url: string;
  credentials: Credentials;
  login_flow: string[];
  success_condition: SuccessCondition;
}

export interface Persona {
  role: string;
  username: string;
  password: string;
  totp_secret?: string;
}

export interface RoleHierarchy {
  role: string;
  level: number;
}

export interface PersonasConfig {
  personas: Persona[];
  role_hierarchy?: RoleHierarchy[];
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  category: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  expected_behavior: string;
}

export interface EnvironmentConfig {
  base_url: string;
  api_base_url?: string;
  timeout_ms?: number;
  viewport?: { width: number; height: number };
}

export interface RegressionTestCase {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  test_category: string;
  description: string;
}

export interface RegressionConfig {
  test_cases: RegressionTestCase[];
}

export type RetryPreset = 'default' | 'subscription';

export interface PipelineConfig {
  retry_preset?: RetryPreset;
  max_concurrent_pipelines?: number;
}

export interface Config {
  authentication?: Authentication;
  acceptance_criteria?: AcceptanceCriterion[];
  personas?: PersonasConfig;
  environment?: EnvironmentConfig;
  rules?: Rules;
  regression?: RegressionConfig;
  pipeline?: PipelineConfig;
}

export interface DistributedConfig {
  skip: Rule[];
  focus: Rule[];
  authentication: Authentication | null;
  personas: PersonasConfig | null;
  acceptanceCriteria: AcceptanceCriterion[];
  environment: EnvironmentConfig | null;
  regression: RegressionConfig | null;
}
