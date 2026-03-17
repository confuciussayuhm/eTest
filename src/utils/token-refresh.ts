/**
 * OAuth token refresh utility for Claude Code credentials.
 *
 * When eTest runs inside Docker with OAuth tokens passed as env vars
 * (extracted from ~/.claude/.credentials.json by the host-side shell script),
 * this utility checks token expiry and refreshes the access token before each
 * agent activity. This prevents 401 errors during long-running UAT workflows.
 *
 * No-op when using ANTHROPIC_API_KEY (no credentials file present).
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';

interface ClaudeOAuthCredentials {
  claudeAiOauth: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes: string[];
    subscriptionType: string;
    rateLimitTier: string;
  };
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

// Claude Code's public OAuth client ID (required for token refresh)
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

// Refresh 5 minutes before expiry to avoid race conditions
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Dedup guard: prevents parallel agents from racing to refresh the same token.
// Only the first caller performs the refresh; concurrent callers await the same promise.
let activeRefresh: Promise<void> | null = null;

/**
 * Ensure the OAuth access token is valid, refreshing if expired.
 *
 * Reads $HOME/.claude/.credentials.json if available, otherwise falls back
 * to CLAUDE_CODE_OAUTH_REFRESH_TOKEN env var for token refresh.
 *
 * Concurrent calls are deduplicated — only the first triggers a refresh,
 * the rest await the same in-flight promise.
 *
 * No-op if:
 * - No credentials file exists and no refresh token env var (using API key auth)
 * - No refresh token available
 * - Token is still valid
 */
export async function ensureValidToken(): Promise<void> {
  if (activeRefresh) {
    return activeRefresh;
  }
  activeRefresh = refreshTokenIfNeeded();
  try {
    await activeRefresh;
  } finally {
    activeRefresh = null;
  }
}

async function refreshTokenIfNeeded(): Promise<void> {
  const credentialsPath = join(process.env.HOME || '/tmp', '.claude', '.credentials.json');

  let credentials: ClaudeOAuthCredentials;
  try {
    const content = await readFile(credentialsPath, 'utf8');
    credentials = JSON.parse(content);
  } catch {
    // No credentials file — try env var refresh token as fallback
    const envRefreshToken = process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN;
    if (!envRefreshToken) return; // No refresh mechanism available

    console.log('No credentials file found, attempting refresh via env var...');

    const tokenEndpoint =
      process.env.ANTHROPIC_TOKEN_ENDPOINT || 'https://console.anthropic.com/v1/oauth/token';

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: envRefreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }).toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OAuth token refresh failed (${response.status}): ${errorText}`);
    }

    const tokenData = (await response.json()) as OAuthTokenResponse;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = tokenData.access_token;
    if (tokenData.refresh_token) {
      process.env.CLAUDE_CODE_OAUTH_REFRESH_TOKEN = tokenData.refresh_token;
    }

    // Persist to credentials file so tokens survive worker restarts
    try {
      await mkdir(dirname(credentialsPath), { recursive: true });
      await writeFile(credentialsPath, JSON.stringify({
        claudeAiOauth: {
          accessToken: tokenData.access_token,
          refreshToken: tokenData.refresh_token || envRefreshToken,
          expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : 0,
          scopes: [],
          subscriptionType: '',
          rateLimitTier: '',
        },
      }, null, 2));
    } catch {
      console.log('Could not persist credentials to file');
    }

    console.log('OAuth token refreshed successfully (from env var)');
    return;
  }

  const oauth = credentials.claudeAiOauth;
  if (!oauth?.refreshToken) return;

  // Always propagate the access token from credentials file into process.env
  // so SDK subprocesses (spawned via claude-executor.ts) can authenticate.
  if (oauth.accessToken) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = oauth.accessToken;
  }

  // Check if token needs refresh
  const now = Date.now();
  if (oauth.expiresAt && now < oauth.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return; // Token still valid and now in process.env
  }

  console.log('OAuth token expired or expiring soon, refreshing...');

  const tokenEndpoint =
    process.env.ANTHROPIC_TOKEN_ENDPOINT || 'https://console.anthropic.com/v1/oauth/token';

  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: oauth.refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OAuth token refresh failed (${response.status}): ${errorText}`);
  }

  const tokenData = (await response.json()) as OAuthTokenResponse;

  // Update process env FIRST so SDK gets the new token even if file write fails
  process.env.CLAUDE_CODE_OAUTH_TOKEN = tokenData.access_token;

  // Update in-memory credentials
  credentials.claudeAiOauth.accessToken = tokenData.access_token;
  if (tokenData.refresh_token) {
    credentials.claudeAiOauth.refreshToken = tokenData.refresh_token;
  }
  if (tokenData.expires_in) {
    credentials.claudeAiOauth.expiresAt = now + tokenData.expires_in * 1000;
  }

  // Write back to file (best-effort — may fail on read-only mounts)
  try {
    await mkdir(dirname(credentialsPath), { recursive: true });
    await writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
  } catch {
    console.log('Could not write updated credentials to file (read-only mount?) — using env var');
  }

  console.log('OAuth token refreshed successfully');
}
