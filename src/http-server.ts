import express from "express";
import { randomBytes, createHash } from "node:crypto";
import { mcpAuthRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { InvalidGrantError, InvalidTokenError, InvalidClientMetadataError, InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthClientInformationFull, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Response } from "express";
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
const clients = new Map<string, OAuthClientInformationFull>();
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
    getClient: id => clients.get(id),
    registerClient: metadata => {
      if (!metadata.redirect_uris.length || !metadata.redirect_uris.every(checkClientRedirect)) {
        throw new InvalidClientMetadataError("Solo se permiten redirecciones HTTPS de ChatGPT.");
      }
      const client = {...metadata, client_id:nonce(), client_id_issued_at:now()};
      clients.set(client.client_id, client);
      return client;
    },
  },
  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response) {
    if (params.resource && params.resource.href !== resource.href) throw new InvalidRequestError("Recurso incorrecto.");
    if (params.scopes?.some(s => s !== "mcp")) throw new InvalidRequestError("Scope incorrecto.");
    const state = nonce(), browser = nonce();
    pending.set(state,{client:client.client_id, params, expires:now()+600, verifier:nonce(), browser:hash(browser)});
    res.cookie("ml_consent", browser, {httpOnly:true, secure:true, sameSite:"lax", maxAge:600000, path:"/oauth"});
    res.setHeader("Content-Security-Policy","default-src 'none'; form-action 'self'; frame-ancestors 'none'");
    res.type("html").send(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Autorizar MCP</title><h1>Conectar Mercado Libre con ChatGPT</h1><p>Cliente: ${escapeHtml(client.client_name ?? "ChatGPT")}.</p><p>Cuenta permitida: ${escapeHtml(process.env.ML_OWNER_ID!)}. Las herramientas ${process.env.ML_READ_ONLY === "true" ? "permiten consultas" : "permiten consultar y modificar publicaciones, responder preguntas y enviar mensajes"}.</p><p>Continuá únicamente si iniciaste esta conexión desde ChatGPT.</p><form action="/oauth/consent" method="post"><input type="hidden" name="state" value="${state}"><button>Continuar a Mercado Libre</button></form></html>`);
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
app.post("/oauth/consent", (req,res) => {
  const g = pending.get(String(req.body.state));
  const cookie = req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith("ml_consent="))?.slice("ml_consent=".length);
  if (!g || g.expires <= now() || g.used || !cookie || hash(cookie) !== g.browser) {
    res.status(400).send("Sesión inválida o vencida. Volvé a conectar desde ChatGPT."); return;
  }
  g.used = true;
  res.redirect(buildAuthUrl(String(req.body.state),hash(g.verifier)));
});
app.get("/oauth/callback", async (req,res) => {
  const state = String(req.query.state ?? ""), g = pending.get(state);
  const cookie = req.headers.cookie?.split(";").map(x=>x.trim()).find(x=>x.startsWith("ml_consent="))?.slice("ml_consent=".length);
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
    res.clearCookie("ml_consent",{path:"/oauth",httpOnly:true,secure:true,sameSite:"lax"});
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
