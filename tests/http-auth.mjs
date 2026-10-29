import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {writeFile,rm,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp = await mkdtemp(join(tmpdir(),'meli-test-'));
const tokenFile=join(temp,'tokens.json');
const preload=join(temp,'mock.mjs');
await writeFile(preload,`
const original=globalThis.fetch;
globalThis.fetch=async (url,options)=>{
 if(String(url)==='https://api.mercadolibre.com/oauth/token') return Response.json({access_token:'FAKE_ML_TOKEN',refresh_token:'FAKE_REFRESH',expires_in:21600});
 if(String(url)==='https://api.mercadolibre.com/users/me') return Response.json({id:123,site_id:'MLA'});
 return original(url,options);
};`);
const server=spawn(process.execPath,['--import',preload,'dist/http-server.js'],{env:{...process.env,PORT:'34781',PUBLIC_BASE_URL:'https://mcp.example.test',ML_REDIRECT_URI:'https://mcp.example.test/oauth/callback',ML_SITE_ID:'MLA',ML_OWNER_ID:'123',ML_CLIENT_ID:'fake-app',ML_CLIENT_SECRET:'fake-secret',ML_TOKENS_FILE:tokenFile,ML_READ_ONLY:'false'},stdio:['ignore','ignore','pipe']});
let logs='';server.stderr.on('data',x=>logs+=x);
const base='http://127.0.0.1:34781';
async function req(path,options={}) {return fetch(base+path,{...options,redirect:'manual'});}
try {
 for(let i=0;i<50;i++){try{await req('/health');break;}catch{await new Promise(r=>setTimeout(r,50));}}
 const denied=await req('/mcp',{method:'POST'});assert.equal(denied.status,401);
 const metadata=await (await req('/.well-known/oauth-authorization-server')).json();assert.equal(metadata.issuer,'https://mcp.example.test/');
 const bad=await req('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://attacker.example/callback']})});assert.equal(bad.status,400);
 const registration=await req('/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({redirect_uris:['https://chatgpt.com/connector_platform/oauth/callback'],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code'],client_name:'ChatGPT test'})});
 assert.equal(registration.status,201);const client=await registration.json();
 const verifier=randomBytes(32).toString('base64url');
 const challenge=createHash('sha256').update(verifier).digest('base64url');
 const params=new URLSearchParams({client_id:client.client_id,response_type:'code',redirect_uri:client.redirect_uris[0],code_challenge:challenge,code_challenge_method:'S256',state:'chatgpt-state',scope:'mcp',resource:'https://mcp.example.test/mcp'});
 const consent=await req('/authorize?'+params);assert.equal(consent.status,200);
 const html=await consent.text();const state=html.match(/name="state" value="([^"]+)"/)[1];
 const cookie=consent.headers.get('set-cookie').split(';')[0];
 const badConsent=await req('/oauth/consent',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({state})});assert.equal(badConsent.status,400);
 const start=await req('/oauth/consent',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',cookie},body:new URLSearchParams({state})});assert.equal(start.status,302);assert.equal(new URL(start.headers.get('location')).hostname,'auth.mercadolibre.com.ar');
 const callback=await req('/oauth/callback?'+new URLSearchParams({state,code:'fake-ml-code'}),{headers:{cookie}});assert.equal(callback.status,302);
 const target=new URL(callback.headers.get('location'));assert.equal(target.searchParams.get('state'),'chatgpt-state');
 const code=target.searchParams.get('code');
 async function exchange(v){return req('/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:client.client_id,redirect_uri:client.redirect_uris[0],code_verifier:v,resource:'https://mcp.example.test/mcp'})});}
 assert.equal((await exchange('x'.repeat(43))).status,400);
 const tokenResponse=await exchange(verifier);assert.equal(tokenResponse.status,200);
 const tokens=await tokenResponse.json();assert.ok(tokens.access_token);assert.notEqual(tokens.access_token,'FAKE_ML_TOKEN');
 assert.equal((await exchange(verifier)).status,400);
 const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream',Authorization:'Bearer '+tokens.access_token};
 const toolsResponse=await req('/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
 assert.equal(toolsResponse.status,200);const tools=await toolsResponse.json();assert.equal(tools.result.tools.length,42);
 const revoked=await req('/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:client.client_id,token:tokens.access_token})});assert.equal(revoked.status,200);
 assert.equal((await req('/mcp',{method:'POST',headers})).status,401);
 console.log('PASS: OAuth metadata, unauthenticated rejection, redirect allowlist, consent CSRF, Argentina login, PKCE, single-use code, 42 tools via HTTP, revocation. All ML responses mocked; no real credentials or writes.');
} catch(e){console.error(logs);throw e;}
finally {server.kill();await rm(temp,{recursive:true,force:true});}
