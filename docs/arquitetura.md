# Arquitetura

## Visão geral

```
┌──────────────────┐   JSON-RPC (stdio)   ┌─────────────────────────────────────────┐
│  Cliente MCP     │ ◄──────────────────► │  Servidor MCP (src/index.ts)            │
│  (Claude Desktop,│    stdin/stdout      │  McpServer + StdioServerTransport       │
│   Kimi Code,     │                      │                                         │
│   Cursor)        │                      │  ┌───────────────────────────────────┐  │
└──────────────────┘                      │  │ Camada de ferramentas (42 tools)  │  │
                                          │  │ zod schemas → handler → ok/fail   │  │
                                          │  └───────────────┬───────────────────┘  │
                                          │                  ▼                      │
                                          │  ┌───────────────────────────────────┐  │
                                          │  │ meli-client.ts                    │  │
                                          │  │ meliGet/Post/Put/Delete/PostForm/ │  │
                                          │  │ GetRaw — Bearer token, retry 401  │  │
                                          │  └───────────────┬───────────────────┘  │
                                          │                  ▼                      │
                                          │  ┌───────────────────────────────────┐  │
                                          │  │ auth.ts                           │  │
                                          │  │ getValidAccessToken/refreshTokens │  │
                                          │  └───────────────┬───────────────────┘  │
                                          │                  ▼                      │
                                          │  ┌───────────────────────────────────┐  │
                                          │  │ token-store.ts (tokens.json 0600) │  │
                                          │  └───────────────────────────────────┘  │
                                          └──────────────────┬──────────────────────┘
                                                             │ HTTPS
                                                             ▼
                                          ┌─────────────────────────────────────────┐
                                          │  api.mercadolibre.com                   │
                                          │  auth.mercadolivre.com.br (autorização) │
                                          └─────────────────────────────────────────┘
```

O cliente MCP inicia o processo do servidor e fala JSON-RPC pelo stdio. Cada ferramenta é registrada com `server.registerTool(name, {description, inputSchema}, handler)`: o SDK expõe o schema (derivado do zod) no `tools/list` e valida os argumentos antes de invocar o handler.

## Fluxo OAuth 2.0

### Autenticação inicial (`npm run auth` → `auth-cli.ts`)

```
Usuário          auth-cli (:3333)         auth.mercadolivre.com.br      api.mercadolibre.com
  │                    │                           │                          │
  │  npm run auth      │                           │                          │
  │───────────────────►│                           │                          │
  │                    │  abre browser (open/      │                          │
  │                    │  xdg-open) com a URL      │                          │
  │                    │──────────────────────────►│                          │
  │  login + autoriza o app                        │                          │
  │───────────────────────────────────────────────►│                          │
  │                    │  redirect :3333/callback  │                          │
  │                    │◄──────────────────────────│                          │
  │                    │  ?code=...                │                          │
  │                    │  POST /oauth/token (authorization_code)              │
  │                    │──────────────────────────────────────────────────────►│
  │                    │                           │     access_token +       │
  │                    │                           │     refresh_token +      │
  │                    │◄──────────────────────────────────────────────────────│
  │                    │  salva tokens.json (0600) │                          │
  │  "Tokens saved"    │                           │                          │
  │◄───────────────────│                           │                          │
```

### Renovação em runtime (`auth.ts`)

```
tool handler → meliGet/... → getValidAccessToken()
                                    │
                    tokens.json válido por mais de 5 min?
                          ┌────sim────┴────não────┐
                          ▼                       ▼
                  retorna o token        POST /oauth/token
                  em cache               (grant_type=refresh_token)
                                                │
                                  salva NOVO access_token + NOVO
                                  refresh_token (Meli rotaciona o
                                  refresh token a cada refresh —
                                  os dois são sempre persistidos)
                                                │
                                  retorna o novo access_token
```

Detalhes importantes:

- O access token do Meli dura **6 horas**; o refresh acontece **5 minutos antes** da expiração (`REFRESH_MARGIN_MS`).
- Refreshes concorrentes são **deduplicados** (`refreshPromise`): como o Meli rotaciona o refresh token, dois refreshes paralelos invalidariam um ao outro.
- Em qualquer resposta **401** da API, o `meli-client` força um refresh e **tenta a chamada uma única vez** de novo.

## Estratégia de tratamento de erros

1. **`MeliApiError`** (`meli-client.ts`): encapsula status HTTP, mensagem do Meli (`message`/`error` do corpo) e o **corpo completo parseado** (`details`).
2. **Retry em 401**: uma única tentativa após refresh forçado; se falhar de novo, o erro sobe.
3. **`fail()` nas ferramentas** (`index.ts`): todo handler é envolto em try/catch e converte exceções em respostas MCP com `isError: true`. Quando o erro é um `MeliApiError` com `details`, o corpo do Meli é anexado à mensagem — é isso que permite ao LLM corrigir erros de validação do `create_item` e entender erros de escopo (Ads/Full/Shops).
4. **Degradação graciosa**: endpoints opcionais falham sem derrubar a chamada principal (ex.: mensagens em `get_claim_detail` são omitidas se o endpoint falhar; `get_mercado_shop` responde `{shop: null}` quando a conta não tem loja). Respostas binárias (`get_shipment_label`) checam o `content-type` e convertem corpos JSON de erro em exceção em vez de salvar o erro como arquivo.

## Decisões de design

- **stdio**: é o transporte padrão para servidores MCP locais — o cliente gerencia o ciclo de vida do processo, não há portas/sockets para configurar, e funciona igual para Claude Desktop, Kimi Code e Cursor. Logs vão para `stderr` (o `stdout` é reservado ao protocolo).
- **zod**: o SDK de MCP deriva o JSON Schema das ferramentas a partir dos schemas zod, e valida os argumentos antes de chamar o handler — validação e documentação (`.describe()`) vivem no mesmo lugar.
- **Parser de `.env` sem dependências**: o projeto só precisa de 4 variáveis; um parser simples (chave=valor, aspas, comentários) evita puxar `dotenv` para isso.
- **tokens.json com modo 0600**: o arquivo contém credenciais de acesso à conta do vendedor; permissões restritas ao dono reduzem exposição. O caminho pode ser sobrescrito por `ML_TOKENS_FILE` (usado no Docker para apontar ao volume persistente).
- **`fetch` nativo**: Node 18+ já traz `fetch`, `FormData` e `Blob` — sem axios/got.
- **Resolução da raiz por `import.meta.url`**: `.env` e `tokens.json` são resolvidos a partir da localização do código (raiz do projeto), não do `cwd` — assim o servidor funciona independente do diretório de onde o cliente MCP o inicia.

## Arquivos em src/

| Arquivo | Responsabilidade |
|---|---|
| `index.ts` | Ponto de entrada do servidor MCP. Registra as 42 ferramentas (descrições em inglês, schemas zod), implementa `ok`/`fail`/`getMyUserId` e conecta o `StdioServerTransport`. |
| `meli-client.ts` | Cliente HTTP de `api.mercadolibre.com`: `meliGet`, `meliPost`, `meliPut`, `meliDelete`, `meliPostForm` (multipart) e `meliGetRaw` (binário). Anexa o Bearer token, faz retry único em 401 após refresh e normaliza erros em `MeliApiError`. |
| `auth.ts` | OAuth 2.0: monta a URL de autorização, troca `code` por tokens, faz refresh com deduplicação de concorrência e persiste sempre os dois tokens (rotação). |
| `auth-cli.ts` | CLI standalone (`npm run auth`): sobe servidor HTTP em `localhost:3333`, abre o navegador na URL de autorização, captura o `code` no `/callback`, troca por tokens e encerra. |
| `token-store.ts` | Leitura/escrita de `tokens.json` (`access_token`, `refresh_token`, `expires_at`), com permissão 0600 e criação do diretório pai. |
| `config.ts` | Carrega `.env` com parser próprio (sem dependências), exporta `config` (clientId, clientSecret, siteId, redirectUri, tokensFile) e `rootDir`. |
