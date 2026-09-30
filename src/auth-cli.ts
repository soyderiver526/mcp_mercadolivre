#!/usr/bin/env node
import http from "node:http";
import { exec } from "node:child_process";
import { buildAuthUrl, exchangeCodeForTokens } from "./auth.js";
import { config } from "./config.js";
import { loadTokens } from "./token-store.js";

const callbackUrl = new URL(config.redirectUri);
const PORT = Number(callbackUrl.port) || 3333;
const CALLBACK_PATH = callbackUrl.pathname || "/callback";

if (!config.clientId || !config.clientSecret) {
  console.error(
    "ML_CLIENT_ID and ML_CLIENT_SECRET must be set in .env before running the auth flow."
  );
  process.exit(1);
}

const authUrl = buildAuthUrl();

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (url.pathname !== CALLBACK_PATH) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Missing 'code' query parameter.");
    return;
  }
  exchangeCodeForTokens(code)
    .then(() => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        "<h1>Autenticacao concluida!</h1><p>Tokens salvos. Voce pode fechar esta aba e voltar ao terminal.</p>"
      );
      console.log(`Tokens saved to ${config.tokensFile}`);
      shutdown(0);
    })
    .catch((err) => {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Token exchange failed: ${(err as Error).message}`);
      console.error("Token exchange failed:", (err as Error).message);
      shutdown(1);
    });
});

function shutdown(code: number): void {
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 1000).unref();
}

server.listen(PORT, () => {
  const existing = loadTokens();
  if (existing) {
    console.log("Existing tokens found — they will be replaced.");
  }
  console.log(`\nListening for the OAuth callback on ${config.redirectUri}`);
  console.log(`\nOpen this URL in your browser to authorize:\n\n${authUrl}\n`);

  const opener =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  exec(`${opener} "${authUrl}"`, (err) => {
    if (err) {
      console.log(
        "(Could not open the browser automatically — copy the URL above.)"
      );
    }
  });
});
