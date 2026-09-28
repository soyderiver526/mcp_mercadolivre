# Contribuindo

Obrigado pelo interesse em contribuir com o MCP Mercado Livre! Este guia é curto e prático.

## Rodando localmente

```bash
git clone https://github.com/gustavossouza/mcp_mercadolivre
cd mcp_mercadolivre
npm install
cp .env.example .env   # preencha com suas credenciais de dev do Meli
npm run build
npm run auth           # autenticação OAuth (opcional para testar o build)
npm start              # sobe o servidor em stdio
```

Verificação rápida sem credenciais: o comando abaixo deve listar as 42 ferramentas.

```bash
printf '%s\n%s\n%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0.1"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node dist/index.js
```

## Padrões do código

- **zod com `.describe()` em todos os campos** — o schema é a documentação que o LLM lê.
- **Descrições das ferramentas em inglês** (são consumidas pelo LLM); README e docs em pt-BR.
- **Erros graciosos**: todo handler envolto em try/catch, retornando `isError: true` com a mensagem clara — nunca derrubar o servidor. Erros do Meli devem incluir o corpo da resposta quando disponível.
- **Respostas compactas**: `JSON.stringify` de objetos reduzidos (só os campos úteis), nunca o payload bruto inteiro da API.
- **Sem dependências novas sem necessidade** — o projeto usa apenas `@modelcontextprotocol/sdk` e `zod`; HTTP é `fetch` nativo.
- Comentários no código só onde a lógica não é óbvia.

## Adicionando uma nova ferramenta (checklist)

1. **Schema zod** com `.describe()` em cada parâmetro (tipos, enums e formatos documentados).
2. **Descrição rica em inglês**: o que faz, QUANDO usar vs. ferramentas relacionadas, significado dos parâmetros, o que retorna e pegadinhas (irreversibilidade, escopos, limites).
3. **Handler** seguindo o padrão `try/catch` + `ok()`/`fail()`, resolvendo o seller id com `getMyUserId()` quando necessário e usando os helpers de `meli-client.ts`.
4. Se precisar de um novo método HTTP ou formato (binário, multipart), adicione o helper em `src/meli-client.ts` seguindo os existentes.
5. **Documentação**: adicione a ferramenta na tabela do `README.md` (grupo correto + marcador 📖/✏️ + contagem total) e crie a seção completa em `docs/tools.md` (parâmetros, endpoint, notas). Atualize `docs/api-map.md` se um endpoint novo for usado.
6. **Verificação**: `npm run build` compila limpo + handshake stdio mostrando a nova ferramenta no `tools/list` e um `tools/call` sem tokens retornando erro gracioso.
7. Operações de escrita devem ter aviso explícito na descrição ("real write operation...").

## Issues e Pull Requests

- **Issues**: descreva o problema, o que você esperava e, se possível, a resposta de erro completa da ferramenta (sem tokens nem dados pessoais!). Sugestões de novas ferramentas são bem-vindas — indique o endpoint da API do Meli correspondente.
- **PRs**: pequenos e focados; siga o checklist acima; garanta `npm run build` limpo antes de abrir. Descreva no PR como você testou (handshake, chamada real com conta de teste etc.).
