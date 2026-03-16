# Testicles CLI - AI User Acceptance Testing Framework (PowerShell)

$ErrorActionPreference = "Stop"

# Detect Podman vs Docker and set compose files accordingly
# Podman doesn't support host-gateway, so we only include the Docker override for actual Docker
$script:COMPOSE_BASE = "docker-compose.yml"
if (Get-Command podman -ErrorAction SilentlyContinue) {
    # Podman detected (either native or via Docker Desktop shim) - use base config only
    $script:COMPOSE_OVERRIDE = ""
} else {
    # Docker detected - include extra_hosts override for Linux localhost access
    $script:COMPOSE_OVERRIDE = "-f docker-compose.docker.yml"
}
$script:COMPOSE_FILE = $script:COMPOSE_BASE

# Load .env if present
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*?)=(.*)$') {
            $key = $Matches[1].Trim()
            $val = $Matches[2].Trim()
            # Strip surrounding quotes if present
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        }
    }
}

# Script-scope variables for parsed arguments
$script:URL = ""
$script:CONFIG = ""
$script:OUTPUT = ""
$script:ID = ""
$script:CLEAN = ""
$script:PIPELINE_TESTING = ""
$script:REGRESSION = ""
$script:TESTS = ""
$script:REBUILD = ""
$script:ROUTER = ""
$script:WORKSPACE = ""

function Show-Help {
    Write-Host @"

  ████████╗███████╗███████╗████████╗██╗ ██████╗██╗     ███████╗███████╗
  ╚══██╔══╝██╔════╝██╔════╝╚══██╔══╝██║██╔════╝██║     ██╔════╝██╔════╝
     ██║   █████╗  ███████╗   ██║   ██║██║     ██║     █████╗  ███████╗
     ██║   ██╔══╝  ╚════██║   ██║   ██║██║     ██║     ██╔══╝  ╚════██║
     ██║   ███████╗███████║   ██║   ██║╚██████╗███████╗███████╗███████║
     ╚═╝   ╚══════╝╚══════╝   ╚═╝   ╚═╝ ╚═════╝╚══════╝╚══════╝╚══════╝

           AI User Acceptance Testing Framework

Usage:
  .\testicles.ps1 start URL=<url>              Start a UAT workflow
  .\testicles.ps1 workspaces                   List all workspaces
  .\testicles.ps1 logs ID=<workflow-id>        Tail logs for a specific workflow
  .\testicles.ps1 stop                         Stop all containers
  .\testicles.ps1 query ID=<workflow-id>       Query workflow status
  .\testicles.ps1 help                         Show this help message

Options for 'start':
  URL=<url>              Target URL to test (required)
  CONFIG=<path>          Configuration file (YAML)
  OUTPUT=<path>          Output directory for reports (default: ./audit-logs/)
  WORKSPACE=<name>       Named workspace (auto-resumes if exists, creates if new)
  PIPELINE_TESTING=true  Use minimal prompts for fast testing
  REGRESSION=true        Run regression test cases from config
  TESTS=<categories>     Comma-separated test categories to run
  ROUTER=true            Route requests through claude-code-router (multi-model support)
  REBUILD=true           Force rebuild Docker images without cache

Options for 'stop':
  CLEAN=true             Remove all data including volumes

Examples:
  .\testicles.ps1 start URL=https://example.com
  .\testicles.ps1 start URL=https://example.com WORKSPACE=sprint-42
  .\testicles.ps1 start URL=https://example.com CONFIG=./config.yaml
  .\testicles.ps1 start URL=https://example.com OUTPUT=./my-reports
  .\testicles.ps1 start URL=https://example.com REGRESSION=true CONFIG=./regression-config.yaml
  .\testicles.ps1 workspaces
  .\testicles.ps1 query ID=example.com_testicles-1234567890
  .\testicles.ps1 logs ID=example.com_testicles-1234567890
  .\testicles.ps1 stop CLEAN=true

Monitor workflows at http://localhost:8233
"@
}

# Parse KEY=value arguments into script-scope variables
function Parse-Args {
    param([string[]]$Arguments)
    foreach ($arg in $Arguments) {
        switch -Wildcard ($arg) {
            "URL=*"              { $script:URL = $arg.Substring(4) }
            "CONFIG=*"           { $script:CONFIG = $arg.Substring(7) }
            "OUTPUT=*"           { $script:OUTPUT = $arg.Substring(7) }
            "ID=*"               { $script:ID = $arg.Substring(3) }
            "CLEAN=*"            { $script:CLEAN = $arg.Substring(6) }
            "PIPELINE_TESTING=*" { $script:PIPELINE_TESTING = $arg.Substring(18) }
            "REGRESSION=*"       { $script:REGRESSION = $arg.Substring(11) }
            "TESTS=*"            { $script:TESTS = $arg.Substring(6) }
            "REBUILD=*"          { $script:REBUILD = $arg.Substring(8) }
            "ROUTER=*"           { $script:ROUTER = $arg.Substring(7) }
            "WORKSPACE=*"        { $script:WORKSPACE = $arg.Substring(10) }
        }
    }
}

# Build compose command arguments as an array
function Get-ComposeArgs {
    $composeArgs = @("-f", $script:COMPOSE_FILE)
    if ($script:COMPOSE_OVERRIDE) {
        $composeArgs += @("-f", ($script:COMPOSE_OVERRIDE -replace '^-f\s+', ''))
    }
    return $composeArgs
}

# Check if Temporal is running and healthy
function Test-TemporalReady {
    try {
        $composeArgs = Get-ComposeArgs
        $output = & docker compose @composeArgs exec -T temporal temporal operator cluster health --address localhost:7233 2>$null
        return ($output -join "`n") -match "SERVING"
    } catch {
        return $false
    }
}

# Ensure containers are running with correct mounts
function Start-Containers {
    $composeArgs = Get-ComposeArgs

    # If custom OUTPUT_DIR is set, always refresh worker to ensure correct volume mount
    if ($env:OUTPUT_DIR) {
        Write-Host "Ensuring worker has correct output mount..."
        try {
            & docker compose @composeArgs up -d worker 2>$null
        } catch {
            # Ignore errors, similar to || true
        }
    }

    # Quick check: if Temporal is already healthy, we're good
    if (Test-TemporalReady) {
        return
    }

    # Need to start containers
    Write-Host "Starting Testicles containers..."
    if ($script:REBUILD -eq "true") {
        # Force rebuild without cache (use when code changes aren't being picked up)
        Write-Host "Rebuilding with --no-cache..."
        & docker compose @composeArgs build --no-cache worker
    }
    & docker compose @composeArgs up -d --build

    # Wait for Temporal to be ready
    Write-Host "Waiting for Temporal to be ready..."
    for ($i = 1; $i -le 30; $i++) {
        if (Test-TemporalReady) {
            Write-Host "Temporal is ready!"
            return
        }
        if ($i -eq 30) {
            Write-Host "Timeout waiting for Temporal"
            exit 1
        }
        Start-Sleep -Seconds 2
    }
}

function Invoke-Start {
    param([string[]]$Arguments)
    Parse-Args $Arguments

    # Validate required vars
    if (-not $script:URL) {
        Write-Host "ERROR: URL is required"
        Write-Host "Usage: .\testicles.ps1 start URL=<url>"
        exit 1
    }

    # Resolve Claude credentials file for OAuth token sharing
    $claudeConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else {
        $homeDir = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
        Join-Path $homeDir ".claude"
    }
    $claudeCredentialsFile = Join-Path $claudeConfigDir ".credentials.json"

    if ((-not $env:ANTHROPIC_API_KEY) -and (-not $env:CLAUDE_CODE_OAUTH_TOKEN)) {
        if (Test-Path $claudeCredentialsFile) {
            Write-Host "Using Claude credentials from $claudeCredentialsFile"
            try {
                $oauthAccess = & node -e "
                    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
                    process.stdout.write(c.claudeAiOauth?.accessToken || '');
                " $claudeCredentialsFile 2>$null
            } catch {
                $oauthAccess = ""
            }
            try {
                $oauthRefresh = & node -e "
                    const c = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
                    process.stdout.write(c.claudeAiOauth?.refreshToken || '');
                " $claudeCredentialsFile 2>$null
            } catch {
                $oauthRefresh = ""
            }
            if ($oauthAccess) { $env:CLAUDE_CODE_OAUTH_TOKEN = $oauthAccess }
            if ($oauthRefresh) { $env:CLAUDE_CODE_OAUTH_REFRESH_TOKEN = $oauthRefresh }
        }
    }

    # Check for API key (Bedrock and router modes can bypass this)
    if ((-not $env:ANTHROPIC_API_KEY) -and (-not $env:CLAUDE_CODE_OAUTH_TOKEN)) {
        if ($env:CLAUDE_CODE_USE_BEDROCK -eq "1") {
            # Bedrock mode - validate required AWS credentials
            $missing = ""
            if (-not $env:AWS_REGION) { $missing += " AWS_REGION" }
            if (-not $env:AWS_BEARER_TOKEN_BEDROCK) { $missing += " AWS_BEARER_TOKEN_BEDROCK" }
            if (-not $env:ANTHROPIC_SMALL_MODEL) { $missing += " ANTHROPIC_SMALL_MODEL" }
            if (-not $env:ANTHROPIC_MEDIUM_MODEL) { $missing += " ANTHROPIC_MEDIUM_MODEL" }
            if (-not $env:ANTHROPIC_LARGE_MODEL) { $missing += " ANTHROPIC_LARGE_MODEL" }
            if ($missing) {
                Write-Host "ERROR: Bedrock mode requires the following env vars in .env:$missing"
                exit 1
            }
        } elseif ($env:CLAUDE_CODE_USE_VERTEX -eq "1") {
            # Vertex AI mode - validate required GCP credentials
            $missing = ""
            if (-not $env:CLOUD_ML_REGION) { $missing += " CLOUD_ML_REGION" }
            if (-not $env:ANTHROPIC_VERTEX_PROJECT_ID) { $missing += " ANTHROPIC_VERTEX_PROJECT_ID" }
            if (-not $env:ANTHROPIC_SMALL_MODEL) { $missing += " ANTHROPIC_SMALL_MODEL" }
            if (-not $env:ANTHROPIC_MEDIUM_MODEL) { $missing += " ANTHROPIC_MEDIUM_MODEL" }
            if (-not $env:ANTHROPIC_LARGE_MODEL) { $missing += " ANTHROPIC_LARGE_MODEL" }
            if ($missing) {
                Write-Host "ERROR: Vertex AI mode requires the following env vars in .env:$missing"
                exit 1
            }
            # Validate service account key file (must be inside ./credentials/ for Docker mount)
            if (-not $env:GOOGLE_APPLICATION_CREDENTIALS) {
                Write-Host "ERROR: Vertex AI mode requires GOOGLE_APPLICATION_CREDENTIALS in .env"
                Write-Host "       Place your service account key in ./credentials/ and set:"
                Write-Host "       GOOGLE_APPLICATION_CREDENTIALS=./credentials/gcp-sa-key.json"
                exit 1
            }
            if (-not (Test-Path $env:GOOGLE_APPLICATION_CREDENTIALS)) {
                Write-Host "ERROR: Service account key file not found: $($env:GOOGLE_APPLICATION_CREDENTIALS)"
                Write-Host "       Download a key from the GCP Console (IAM > Service Accounts > Keys)"
                exit 1
            }
        } elseif (($script:ROUTER -eq "true") -and ($env:OPENAI_API_KEY -or $env:OPENROUTER_API_KEY)) {
            # Router mode with alternative provider - set a placeholder for SDK init
            $env:ANTHROPIC_API_KEY = "router-mode"
        } else {
            Write-Host "ERROR: Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN in .env"
            Write-Host "       (or run 'claude login' to authenticate via OAuth,"
            Write-Host "        use CLAUDE_CODE_USE_BEDROCK=1 for AWS Bedrock,"
            Write-Host "        CLAUDE_CODE_USE_VERTEX=1 for Google Vertex AI,"
            Write-Host "        or ROUTER=true with OPENAI_API_KEY or OPENROUTER_API_KEY)"
            exit 1
        }
    }

    # Handle custom OUTPUT directory
    # Export OUTPUT_DIR for docker-compose volume mount BEFORE starting containers
    if ($script:OUTPUT) {
        # Create output directory (no chmod on Windows)
        New-Item -ItemType Directory -Force -Path $script:OUTPUT | Out-Null
        $env:OUTPUT_DIR = $script:OUTPUT
    }

    # Handle ROUTER flag - start claude-code-router for multi-model support
    if ($script:ROUTER -eq "true") {
        $composeArgs = Get-ComposeArgs
        # Check if router is already running
        $routerStatus = ""
        try {
            $routerStatus = & docker compose @composeArgs --profile router ps router 2>$null
        } catch {}
        if ($routerStatus -match "running") {
            Write-Host "Router already running, skipping startup..."
        } else {
            Write-Host "Starting claude-code-router..."

            # Check for provider API keys
            if ((-not $env:OPENAI_API_KEY) -and (-not $env:OPENROUTER_API_KEY)) {
                Write-Host "WARNING: No provider API key set (OPENAI_API_KEY or OPENROUTER_API_KEY). Router may not work."
            }

            # Start router with profile
            & docker compose @composeArgs --profile router up -d router

            # Give router a few seconds to start
            Write-Host "Waiting for router to start..."
            Start-Sleep -Seconds 5
        }

        # Set ANTHROPIC_BASE_URL to route through router
        $env:ANTHROPIC_BASE_URL = "http://router:3456"
        # Set auth token to match router's APIKEY
        $env:ANTHROPIC_AUTH_TOKEN = "testicles-router-key"
    }

    # Ensure audit-logs directory exists (no chmod on Windows)
    New-Item -ItemType Directory -Force -Path ./audit-logs | Out-Null
    New-Item -ItemType Directory -Force -Path ./credentials | Out-Null

    # Ensure containers are running (starts them if needed)
    Start-Containers

    # Build optional args
    $execArgs = @()
    if ($script:CONFIG) { $execArgs += @("--config", $script:CONFIG) }

    # Pass container path for output (where OUTPUT_DIR is mounted)
    # Also pass display path so client can show the host path to user
    if ($script:OUTPUT) {
        $execArgs += @("--output", "/app/output", "--display-output", $script:OUTPUT)
    }

    if ($script:PIPELINE_TESTING -eq "true") { $execArgs += "--pipeline-testing" }
    if ($script:WORKSPACE) { $execArgs += @("--workspace", $script:WORKSPACE) }
    if ($script:REGRESSION -eq "true") { $execArgs += "--regression" }
    if ($script:TESTS) { $execArgs += @("--tests", $script:TESTS) }

    # Run the client to submit workflow to testicles-pipeline task queue
    $composeArgs = Get-ComposeArgs
    & docker compose @composeArgs exec -T worker node dist/temporal/client.js $script:URL @execArgs
}

function Invoke-Query {
    param([string[]]$Arguments)
    Parse-Args $Arguments

    if (-not $script:ID) {
        Write-Host "ERROR: ID is required"
        Write-Host "Usage: .\testicles.ps1 query ID=<workflow-id>"
        exit 1
    }

    # Ensure containers are running
    Start-Containers

    $composeArgs = Get-ComposeArgs
    & docker compose @composeArgs exec -T worker node dist/temporal/client.js --query --id $script:ID
}

function Invoke-Logs {
    param([string[]]$Arguments)
    Parse-Args $Arguments

    if (-not $script:ID) {
        Write-Host "ERROR: ID is required"
        Write-Host "Usage: .\testicles.ps1 logs ID=<workflow-id>"
        exit 1
    }

    # Auto-discover the workflow log file
    $workflowLog = ""

    $directPath = "./audit-logs/$($script:ID)/workflow.log"
    if (Test-Path $directPath) {
        $workflowLog = $directPath
    } else {
        # For resume workflow IDs (e.g. workspace_resume_123), check the original workspace
        $workspaceId = $script:ID -replace '_resume_.*$', ''
        if (($workspaceId -ne $script:ID) -and (Test-Path "./audit-logs/$workspaceId/workflow.log")) {
            $workflowLog = "./audit-logs/$workspaceId/workflow.log"
        }

        # For named workspace IDs (e.g. workspace_testicles-123), check the workspace name
        if (-not $workflowLog) {
            $workspaceId = $script:ID -replace '_testicles-.*$', ''
            if (($workspaceId -ne $script:ID) -and (Test-Path "./audit-logs/$workspaceId/workflow.log")) {
                $workflowLog = "./audit-logs/$workspaceId/workflow.log"
            }
        }

        if (-not $workflowLog) {
            # Search for the workflow directory (handles custom OUTPUT paths)
            $found = Get-ChildItem -Recurse -Depth 3 -Filter "workflow.log" -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -like "*$($script:ID)*" } |
                Select-Object -First 1
            if ($found) {
                $workflowLog = $found.FullName
            }
        }
    }

    if ($workflowLog) {
        Write-Host "Tailing workflow log: $workflowLog"
        Get-Content -Path $workflowLog -Wait -Tail 50
    } else {
        Write-Host "ERROR: Workflow log not found for ID: $($script:ID)"
        Write-Host ""
        Write-Host "Possible causes:"
        Write-Host "  - Workflow hasn't started yet"
        Write-Host "  - Workflow ID is incorrect"
        Write-Host ""
        Write-Host "Check the Temporal Web UI at http://localhost:8233 for workflow details"
        exit 1
    }
}

function Invoke-Workspaces {
    # Ensure containers are running (need worker to execute node)
    Start-Containers

    $composeArgs = Get-ComposeArgs
    & docker compose @composeArgs exec -T worker node dist/temporal/workspaces.js
}

function Invoke-Stop {
    param([string[]]$Arguments)
    Parse-Args $Arguments

    $composeArgs = Get-ComposeArgs
    if ($script:CLEAN -eq "true") {
        & docker compose @composeArgs --profile router down -v
    } else {
        & docker compose @composeArgs --profile router down
    }
}

# Main command dispatch
$command = if ($args.Count -gt 0) { $args[0] } else { "help" }
$remaining = if ($args.Count -gt 1) { $args[1..($args.Count - 1)] } else { @() }

switch ($command) {
    "start"      { Invoke-Start $remaining }
    "query"      { Invoke-Query $remaining }
    "logs"       { Invoke-Logs $remaining }
    "workspaces" { Invoke-Workspaces }
    "stop"       { Invoke-Stop $remaining }
    default      { Show-Help }
}
