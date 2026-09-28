import { config } from "./config.js";
import { loadTokens, saveTokens, type StoredTokens } from "./token-store.js";

const AUTH_URL = "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function buildAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds (Meli: 6 hours)
}

async function requestToken(
  body: Record<string, string>
): Promise<StoredTokens> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(
      `Token request failed (HTTP ${res.status}): ${
        (data.message as string) ?? JSON.stringify(data)
      }`
    );
  }
  const tr = data as unknown as TokenResponse;
  const tokens: StoredTokens = {
    access_token: tr.access_token,
    refresh_token: tr.refresh_token,
    expires_at: Date.now() + tr.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

export async function exchangeCodeForTokens(
  code: string
): Promise<StoredTokens> {
  return requestToken({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });
}

// Deduplicates concurrent refreshes: Meli rotates the refresh token, so two
// parallel refreshes would invalidate each other.
let refreshPromise: Promise<StoredTokens> | null = null;

export async function refreshTokens(): Promise<StoredTokens> {
  const current = loadTokens();
  if (!current?.refresh_token) {
    throw new Error("No tokens stored. Run the auth flow first.");
  }
  refreshPromise ??= requestToken({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: current.refresh_token,
  }).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

export async function getValidAccessToken(): Promise<string> {
  const tokens = loadTokens();
  if (tokens && tokens.expires_at - REFRESH_MARGIN_MS > Date.now()) {
    return tokens.access_token;
  }
  const refreshed = await refreshTokens();
  return refreshed.access_token;
}
