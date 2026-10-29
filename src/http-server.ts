import express from "express";
import { randomBytes, createHash, createCipheriv, createDecipheriv, hkdfSync } from "node:crypto";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
import { OAuthClientInformationFullSchema } from "@modelcontextprotocol/sdk/shared/auth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildAuthUrl, exchangeCodeForTokens } from "./auth.js";
import { config } from "./config.js";

process.env.ML_TRANSPORT = "http";
const { createMcpServer } = await import("./index.js");
const publicUrl = new URL(process.env.PUBLIC_BASE_URL ?? process.env.RENDER_EXTERNAL_URL ?? "");
if (publicUrl.protocol !== "https:") throw new Error("PUBLIC_BASE_URL debe usar HTTPS.");
if (!process.env.ML_OWNER_ID || !process.env.ML_CLIENT_ID || !process.env.ML_CLIENT_SECRET) {
  throw new Error("Faltan ML_OWNER_ID, ML_CLIENT_ID o ML_CLIENT_SECRET.");
}
if (config.redirectUri !== new URL("/oauth/callback", publicUrl).href) {
  throw new Error("ML_REDIRECT_URI debe ser PUBLIC_BASE_URL + /oauth/callback.");
}
const resource = new URL("/mcp", publicUrl);
const nonce = () => randomBytes(32).toString("base64url");
const hash = (s: string) => createHash("sha256").update(s).digest("base64url");
const now = () => Math.floor(Date.now() / 1000);
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
type Grant = { client: string; params: AuthorizationParams; expires: number; verifier: string; browser: string; used?: boolean };
type Ticket = { client: string; challenge: string; redirect: string; expires: number };
type Access = { client: string; expires: number; family: string };
// Registration must survive Render restarts without a paid disk. Client IDs
// carry authenticated encrypted metadata, never Mercado Libre credentials.
// Rotating the application secret deliberately invalidates registrations.
const registrationKey = Buffer.from(hkdfSync(
  "sha256", process.env.ML_CLIENT_SECRET!, publicUrl.origin,
  "mcp-client-registration-v1:" + process.env.ML_OWNER_ID, 32,
));
function encodeClient(metadata: Record<string, unknown>): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", registrationKey, iv);
  cipher.setAAD(Buffer.from(resource.href));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(metadata)), cipher.final()]);
  return "v1." + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
function decodeClient(id: string): OAuthClientInformationFull | undefined {
  try {
    if (!id.startsWith("v1.") || id.length > 12000) return undefined;
    const raw = Buffer.from(id.slice(3), "base64url");
    if (raw.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", registrationKey, raw.subarray(0,12));
    decipher.setAAD(Buffer.from(resource.href));
    decipher.setAuthTag(raw.subarray(12,28));
    const json = Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString("utf8");
    const client = OAuthClientInformationFullSchema.parse({...JSON.parse(json),client_id:id});
    if (!client.redirect_uris.length || !client.redirect_uris.every(checkClientRedirect)) return undefined;
    return client;
  } catch { return undefined; }
}
const pending = new Map<string, Grant>();
const codes = new Map<string, Ticket>();
const access = new Map<string, Access>();
const refresh = new Map<string, Access>();
function checkClientRedirect(uri: string) {
  const u = new URL(uri);
  return u.protocol === "https:" && ["chatgpt.com","chat.openai.com"].includes(u.hostname) && !u.username && !u.password && !u.hash;
}
function issue(client: string, family = nonce()): OAuthTokens {
  const a = nonce(), r = nonce();
  access.set(hash(a), {client, family, expires: now() + 3600});
  refresh.set(hash(r), {client, family, expires: now() + 86400 * 7});
  return {access_token:a, refresh_token:r, token_type:"Bearer", expires_in:3600, scope:"mcp"};
}
const provider: OAuthServerProvider = {
  // The provider performs PKCE below. The SDK otherwise validates it itself
  // and intentionally omits the verifier when calling exchangeAuthorizationCode.
  skipLocalPkceValidation: true,
  clientsStore: {
    getClient: id => decodeClient(id),
    registerClient: metadata => {
      if (!metadata.redirect_uris.length || !metadata.redirect_uris.every(checkClientRedirect)) {
        throw new InvalidClientMetadataError("Solo se permiten redirecciones HTTPS de ChatGPT.");
      }
      const record = {...metadata, client_id_issued_at:now(), registration_nonce:nonce()} as Record<string, unknown>;
      delete record.client_id;
      const client_id = encodeClient(record);
      if (client_id.length > 12000) throw new InvalidClientMetadataError("Registro demasiado grande.");
      return {...metadata,client_id,client_id_issued_at:record.client_id_issued_at as number};
    },
  },
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource && params.resource.href !== resource.href) throw new InvalidRequestError("Recurso incorrecto.");
    if (params.scopes?.some(s => s !== "mcp")) throw new InvalidRequestError("Scope incorrecto.");
    const state = nonce();
    pending.set(state,{client:client.client_id, params, expires:now()+600, verifier:nonce(), browser:""});
    // Establish the consent page in a first-party GET context. Some browsers
    // do not send Lax cookies on forms rendered directly by a cross-site POST.
    res.redirect(303, "/oauth/review?session=" + state);
  },
  async challengeForAuthorizationCode(client, code) {
    const t = codes.get(hash(code));
    if (!t || t.client !== client.client_id || t.expires <= now()) throw new InvalidGrantError("Autorización inválida o vencida.");
    return t.challenge;
  },
  async exchangeAuthorizationCode(client, code, verifier, redirect) {
    const key = hash(code), t = codes.get(key);
    if (!t || t.client !== client.client_id || t.expires <= now() || t.redirect !== redirect || !verifier || hash(verifier) !== t.challenge) throw new InvalidGrantError("Autorización inválida o vencida.");
    codes.delete(key);
    return issue(client.client_id);
  },
  async exchangeRefreshToken(client, token, scopes) {
    const old = refresh.get(hash(token));
    if (!old || old.client !== client.client_id || old.expires <= now() || scopes?.some(s => s !== "mcp")) throw new InvalidGrantError("Autorización inválida o vencida.");
    refresh.delete(hash(token));
    return issue(client.client_id, old.family);
  },
  async verifyAccessToken(token) {
    const t = access.get(hash(token));
    if (!t || t.expires <= now()) throw new InvalidTokenError("Token inválido o vencido.");
    return {token, clientId:t.client, scopes:["mcp"], expiresAt:t.expires, resource};
  },
  async revokeToken(client, request) {
    const t = access.get(hash(request.token)) ?? refresh.get(hash(request.token));
    if (!t || t.client !== client.client_id) return;
    for (const map of [access, refresh]) for (const [k,v] of map) if (v.family === t.family) map.delete(k);
  },
};
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((_req,res,next) => {res.setHeader("Cache-Control","no-store"); res.setHeader("Referrer-Policy","no-referrer"); next();});
app.use(express.urlencoded({extended:false,limit:"16kb"}));
app.use(mcpAuthRouter({provider, issuerUrl:publicUrl, resourceServerUrl:resource, scopesSupported:["mcp"], resourceName:"Mercado Libre Argentina — vendedor"}));
app.get("/health", (_req,res) => res.json({status:"ok",site:process.env.ML_SITE_ID, authenticated:false}));
function consentCookie(state: string) { return "ml_consent_" + hash(state).slice(0,24); }
app.get("/oauth/review", (req,res) => {
  const state = typeof req.query.session === "string" ? req.query.session : "";
  const g = pending.get(state);
  if (!g || g.expires <= now() || g.used) {
    res.status(400).send("La autorización venció. Volvé a conectar desde ChatGPT. [review-expired]");
    return;
  }
  const browser = nonce();
  g.browser = hash(browser);
  res.cookie(consentCookie(state), browser, {httpOnly:true, secure:true, sameSite:"lax", maxAge:600000, path:"/oauth"});
  res.setHeader("Content-Security-Policy","default-src 'none'; form-action 'self' https://auth.mercadolibre.com.ar https://auth.mercadolivre.com.br; frame-ancestors 'none'; base-uri 'none'");
  res.type("html").send(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Autorizar MCP</title><h1>Conectar Mercado Libre con ChatGPT</h1><p>Cuenta permitida: ${escapeHtml(process.env.ML_OWNER_ID!)}.</p><p>Las herramientas ${process.env.ML_READ_ONLY === "true" ? "permiten consultas" : "permiten consultar y modificar publicaciones, responder preguntas y enviar mensajes"}.</p><p>Continuá únicamente si iniciaste esta conexión desde ChatGPT.</p><form action="/oauth/consent" method="post"><input type="hidden" name="state" value="${state}"><button>Continuar a Mercado Libre</button></form></html>`);
});
app.post("/oauth/consent", (req,res) => {
  const state = typeof req.body.state === "string" ? req.body.state : "";
  const g = pending.get(state);
  const prefix = consentCookie(state) + "=";
  const cookie = req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith(prefix))?.slice(prefix.length);
  if (!g || g.expires <= now() || g.used || !cookie || hash(cookie) !== g.browser) {
    const reason = !g ? "session-missing" : g.expires <= now() ? "session-expired" : g.used ? "session-used" : !cookie ? "cookie-missing" : "cookie-mismatch";
    console.error("OAuth consent rejected:", reason);
    res.status(400).send("No se pudo continuar la sesión. Volvé a conectar desde ChatGPT. [" + reason + "]"); return;
  }
  g.used = true;
  res.redirect(buildAuthUrl(String(req.body.state),hash(g.verifier)));
});
app.get("/oauth/callback", async (req,res) => {
  const state = String(req.query.state ?? ""), g = pending.get(state);
  const prefix = consentCookie(state) + "=";
  const cookie = req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith(prefix))?.slice(prefix.length);
  if (!g || g.expires <= now() || !g.used || !cookie || hash(cookie) !== g.browser || typeof req.query.code !== "string") {
    res.status(400).send("Autorización inválida o vencida. Reiniciá la conexión desde ChatGPT."); return;
  }
  pending.delete(state);
  try {
    await exchangeCodeForTokens(req.query.code,g.verifier);
    const code = nonce();
    codes.set(hash(code),{client:g.client, challenge:g.params.codeChallenge, redirect:g.params.redirectUri, expires:now()+120});
    const target = new URL(g.params.redirectUri);
    target.searchParams.set("code",code);
    if(g.params.state) target.searchParams.set("state",g.params.state);
    res.clearCookie(consentCookie(state),{path:"/oauth",httpOnly:true,secure:true,sameSite:"lax"});
    res.redirect(target.href);
  } catch {
    res.status(400).send("No se pudo autorizar la cuenta configurada. Revisá cuenta, permisos y configuración de la aplicación.");
  }
});
const auth = requireBearerAuth({verifier:provider,requiredScopes:["mcp"],expectedResource:resource,resourceMetadataUrl:new URL("/.well-known/oauth-protected-resource/mcp",publicUrl).href});
app.post("/mcp", auth, express.json({limit:"2mb"}), async (req,res) => {
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
  res.on("close",()=>{void transport.close(); void server.close();});
  try {await server.connect(transport); await transport.handleRequest(req,res,req.body);}
  catch {if(!res.headersSent) res.status(500).json({error:"MCP request failed"});}
});
app.all("/mcp",auth,(_req,res)=>res.status(405).setHeader("Allow","POST").end());
setInterval(()=>{
  for (const map of [pending,codes,access,refresh]) for (const [k,v] of map) if(v.expires <= now()) map.delete(k);
},60000).unref();
app.listen(Number(process.env.PORT ?? 3000),"0.0.0.0",()=>console.error("MCP HTTP listo; autorización requerida."));
