# Testicles — AI UAT Framework

> Named after the lesser-known Greek philosopher **Testicles of Thessaloniki** (*Testikleos*, c. 412–348 BC),
> a contemporary of Aristotle who argued that knowledge could only be attained through rigorous, repeatable
> observation. His sole surviving fragment reads: *"That which is not tested is not known"*
> (*ho me dokimastheis ou gignosketai*). While Plato pursued truth through dialectic, Testicles insisted on
> empirical verification — an approach that, perhaps unsurprisingly, failed to gain traction in 4th-century Athens.

An autonomous, black-box User Acceptance Testing framework powered by AI agents. Point it at a URL,
and 31 AI agents collaboratively discover your application, plan tests across 12 categories, execute them
via browser automation, and produce a detailed UAT report — all from a single command.

---

## What is Testicles?

Testicles is an AI-driven UAT framework that treats your web application as a black box and autonomously
performs end-to-end acceptance testing. It is based on [Shannon](https://github.com/KeygraphHQ/shannon)
(an AI pentesting framework), re-targeted from security testing to user acceptance testing.

- **31 AI agents** across **12 test categories**
- **Claude Agent SDK** for orchestrating autonomous AI agents
- **Temporal.io** for durable, resumable workflow execution
- **Playwright MCP** for real browser interaction (screenshots, clicks, navigation)
- **Single command**: `./testicles start URL=<url>`

## Quick Start

### Prerequisites

- Docker (or Podman)
- An Anthropic API key (or AWS Bedrock / Google Vertex AI credentials)

### Setup

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/Testicles.git
cd Testicles

# Configure your API key
cp .env.example .env
# Edit .env and set ANTHROPIC_API_KEY=sk-ant-...

# Run against a target
./testicles start URL=https://example.com
```

### Monitor

Open the Temporal Web UI at [http://localhost:8233](http://localhost:8233) to watch workflow progress in real time.

## How It Works

```
                           ./testicles start URL=<url>
                                      │
                              ┌───────▼────────┐
                              │   Preflight    │  Validate config, API keys, connectivity
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │   Discovery    │  Crawl target, map pages, identify features
                              └───────┬────────┘
                                      │
                              ┌───────▼────────┐
                              │   Scenario     │  Generate test scenarios from discovery
                              │   Planning     │  findings and acceptance criteria
                              └───────┬────────┘
                                      │
                    ┌─────────────────┬┴┬─────────────────┐
                    │                 │ │                  │
              ┌─────▼─────┐   ┌──────▼─▼────┐    ┌───────▼──────┐
              │  Plan +   │   │  Plan +     │    │  Plan +      │  12 categories
              │  Execute  │   │  Execute    │    │  Execute     │  run in parallel
              │  (nav)    │   │  (forms)    │    │  (auth...)   │
              └─────┬─────┘   └──────┬──────┘    └───────┬──────┘
                    │                │                    │
                    └────────────────┼────────────────────┘
                                     │
                              ┌──────▼───────┐
                              │  Multi-      │  Optional: cross-role
                              │  Persona     │  authorization testing
                              └──────┬───────┘
                                     │
                              ┌──────▼───────┐
                              │   Report     │  Consolidated UAT report
                              └──────────────┘
```

## Test Categories

| Category | Description |
|---|---|
| **Navigation** | Page links, routing, breadcrumbs, menu structure |
| **Forms** | Input validation, submission, error handling |
| **Auth** | Login, logout, session management, 2FA |
| **Authz** | Role-based access control, permission boundaries |
| **Data** | Data integrity, CRUD operations, persistence |
| **UI/UX** | Visual consistency, responsive layout, usability |
| **API** | REST endpoint behavior, status codes, payloads |
| **Cross-Browser** | Rendering and behavior across browser engines |
| **Accessibility** | WCAG compliance, screen reader compatibility, ARIA |
| **Performance** | Load times, responsiveness, resource usage |
| **Errors** | Error handling, edge cases, graceful degradation |
| **E2E** | Full user journey flows across multiple features |

Additionally, **Multi-Persona** testing performs cross-role authorization verification using configurable user personas.

## Configuration

Tests can be customized with a YAML configuration file. See [`configs/example-config.yaml`](configs/example-config.yaml) for full documentation.

```yaml
authentication:
  login_type: form
  login_url: "https://example.com/login"
  credentials:
    username: "testuser@example.com"
    password: "testpassword123"
  login_flow:
    - "Type $username into the email field"
    - "Type $password into the password field"
    - "Click the 'Sign In' button"

acceptance_criteria:
  - id: "AC-001"
    description: "User can successfully log in"
    category: "auth"
    priority: "critical"

rules:
  skip:
    - description: "Skip logout to preserve sessions"
      type: path
      url_path: "/logout"
  focus:
    - description: "Prioritize checkout flow"
      type: path
      url_path: "/checkout/*"
```

```bash
./testicles start URL=https://example.com CONFIG=./my-config.yaml
```

## CLI Reference

```
Usage:
  ./testicles start URL=<url>              Start a UAT workflow
  ./testicles workspaces                   List all workspaces
  ./testicles logs ID=<workflow-id>        Tail logs for a specific workflow
  ./testicles stop                         Stop all containers
  ./testicles query ID=<workflow-id>       Query workflow status
  ./testicles help                         Show this help message

Options for 'start':
  URL=<url>              Target URL to test (required)
  CONFIG=<path>          Configuration file (YAML)
  OUTPUT=<path>          Output directory for reports (default: ./audit-logs/)
  WORKSPACE=<name>       Named workspace (auto-resumes if exists)
  PIPELINE_TESTING=true  Use minimal prompts for fast testing
  REGRESSION=true        Run regression test cases from config
  TESTS=<categories>     Comma-separated test categories to run
  ROUTER=true            Route through claude-code-router (multi-model)
  REBUILD=true           Force rebuild Docker images without cache

Options for 'stop':
  CLEAN=true             Remove all data including volumes
```

### Examples

```bash
# Basic UAT run
./testicles start URL=https://example.com

# With named workspace (resumable)
./testicles start URL=https://example.com WORKSPACE=sprint-42

# With custom config and output directory
./testicles start URL=https://example.com CONFIG=./config.yaml OUTPUT=./my-reports

# Run only specific test categories
./testicles start URL=https://example.com TESTS=auth,forms,navigation

# Regression testing
./testicles start URL=https://example.com REGRESSION=true CONFIG=./regression-config.yaml

# Monitor a running workflow
./testicles logs ID=example.com_testicles-1234567890

# Clean shutdown
./testicles stop CLEAN=true
```

## AI Provider Support

| Provider | Setup |
|---|---|
| **Anthropic** (default) | Set `ANTHROPIC_API_KEY` in `.env` |
| **AWS Bedrock** | Set `CLAUDE_CODE_USE_BEDROCK=1` + AWS credentials |
| **Google Vertex AI** | Set `CLAUDE_CODE_USE_VERTEX=1` + GCP credentials |
| **OpenAI / OpenRouter** | Use `ROUTER=true` with `OPENAI_API_KEY` or `OPENROUTER_API_KEY` |

See [`.env.example`](.env.example) for full provider configuration details.

## Architecture

Testicles is built on the architecture of [Shannon](https://github.com/KeygraphHQ/shannon), an AI penetration testing framework, with a domain mapping from security testing to user acceptance testing.

- **TypeScript** — fully typed codebase
- **Temporal.io** — durable workflow orchestration with automatic retries and resumability
- **Claude Agent SDK** — autonomous AI agent execution with tool use
- **Playwright MCP** — browser automation via Model Context Protocol servers
- **Docker Compose** — containerized deployment (Temporal + worker + optional router)

## License

TBD
