import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function loadDotEnv(): void {
  let content: string;
  try {
    content = fs.readFileSync(path.join(rootDir, ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export const config = {
  clientId: process.env.ML_CLIENT_ID ?? "",
  clientSecret: process.env.ML_CLIENT_SECRET ?? "",
  siteId: process.env.ML_SITE_ID ?? "MLB",
  redirectUri: process.env.ML_REDIRECT_URI ?? "http://localhost:3333/callback",
  tokensFile:
    process.env.ML_TOKENS_FILE ?? path.join(rootDir, "tokens.json"),
  readOnly: ["true", "1"].includes(
    (process.env.ML_READ_ONLY ?? "").toLowerCase()
  ),
  toolProfile: process.env.ML_TOOL_PROFILE ?? "all",
};
