import { config } from "./config.js";
import { loadTokens, saveTokens, type StoredTokens } from "./token-store.js";

const AUTH_URL = config.siteId === "MLA"
  ? "https://auth.mercadolibre.com.ar/authorization"
  : "https://auth.mercadolivre.com.br/authorization";
const TOKEN_URL = "https://api.mercadolibre.com/oauth/token";
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function buildAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
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
  if (body.grant_type === "authorization_code" && process.env.ML_OWNER_ID) {
    const me = await fetch("https://api.mercadolibre.com/users/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (!me.ok) throw new Error("No se pudo verificar la cuenta autorizada.");
    const account = await me.json() as {id: number; site_id: string};
    if (String(account.id) !== process.env.ML_OWNER_ID || account.site_id !== config.siteId) {
      throw new Error("La cuenta autorizada no coincide con el vendedor configurado.");
    }
  }
  saveTokens(tokens);
  return tokens;
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string
): Promise<StoredTokens> {
  return requestToken({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    code_verifier: codeVerifier,
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
