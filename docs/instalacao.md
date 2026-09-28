# Guia de instalação (para iniciantes)

Este guia assume que você **nunca** usou MCP nem a API do Mercado Livre. Siga os passos na ordem e, ao final, você terá um assistente de IA (Claude, Cursor ou Kimi Code) conversando com a sua conta de vendedor do Mercado Livre.

---

## Pré-requisitos

### Node.js 18 ou superior

1. Baixe e instale a versão LTS em [nodejs.org](https://nodejs.org/) (o botão grande verde já serve).
2. Verifique no terminal:
   ```bash
   node -v
   ```
   Deve aparecer algo como `v20.x.x` — qualquer versão **18 ou maior** funciona.

### Git

- macOS: `git --version` (o sistema oferece instalar as ferramentas de linha de comando se necessário).
- Windows: instale por [git-scm.com](https://git-scm.com/).
- Linux: `sudo apt install git` (Debian/Ubuntu) ou equivalente.

> **Alternativa:** se preferir não instalar Node, dá para rodar tudo com Docker — veja a seção [Alternativa: Docker](#alternativa-docker). Os passos 2 e 3 (app no Meli e `.env`) são necessários de qualquer forma.

---

## Passo 1 — Clonar o repositório

```bash
git clone https://github.com/gustavossouza/mcp_mercadolivre
cd mcp_mercadolivre
```

## Passo 2 — Criar o aplicativo no portal de desenvolvedores do Mercado Livre

1. Acesse [developers.mercadolivre.com.br](https://developers.mercadolivre.com.br) e entre com a **mesma conta que você usa para vender** no Mercado Livre.
2. Se for a primeira vez, aceite os termos para ativar sua conta de desenvolvedor.
3. Clique em **Criar nova aplicação** ("Create new application") e preencha:
   - **Nome**: algo como `meu-mcp` (só você verá).
   - **Tipo de solução**: pode escolher a opção genérica/outros.
   - **Redirect URI**: `http://localhost:3333/callback` — **exatamente assim**, com porta e caminho.
     > Se o formulário recusar a URL `http://localhost`, cadastre temporariamente `https://localhost/callback` — o `http://localhost:3333/callback` ainda funcionará na hora de autenticar (veja Solução de problemas no [README](../README.md#solução-de-problemas)).
   - **Scopes** (permissões): marque **`read`**, **`write`** e **`offline_access`**.
     - `read`: ler anúncios, pedidos, perguntas...
     - `write`: criar/editar anúncios, responder perguntas...
     - `offline_access`: permite renovar o token automaticamente (sem isso você teria que autenticar de novo a cada 6 horas!).
4. Salve e anote o **Client ID** (também chamado de *App ID*) e o **Client Secret** (*Secret Key*) — ficam visíveis na tela de detalhes do aplicativo. O Client Secret é uma senha: não compartilhe nem suba no git.

## Passo 3 — Configurar o arquivo .env

```bash
cp .env.example .env
```

Abra o `.env` num editor e preencha:

```
ML_CLIENT_ID=1234567890123456        # seu Client ID (App ID)
ML_CLIENT_SECRET=aBcDeFgHiJkLmNoPqR  # seu Client Secret
ML_SITE_ID=MLB                       # site: MLB = Brasil (não mude se vende no BR)
ML_REDIRECT_URI=http://localhost:3333/callback
```

## Passo 4 — Instalar dependências e compilar

```bash
npm install
npm run build
```

Saída esperada: o `npm install` termina com algo como `added N packages` e o `npm run build` termina **sem mensagens de erro** (o TypeScript é silencioso quando dá tudo certo). Isso gera a pasta `dist/`.

## Passo 5 — Autenticar (conectar sua conta do Meli)

```bash
npm run auth
```

O que vai acontecer:

1. O terminal mostra uma URL longa de autorização e o navegador abre sozinho nela.
2. Faça login no Mercado Livre (se ainda não estiver logado) e clique em **Autorizar**.
3. O navegador é redirecionado para `localhost:3333` e mostra **"Autenticacao concluida!"** — pode fechar a aba.
4. No terminal aparece `Tokens saved to .../tokens.json`.

Pronto! O servidor guarda os tokens em `tokens.json` e os renova sozinho (o access token dura 6h; a renovação é automática graças ao scope `offline_access`).

## Passo 6 — Conectar no seu cliente MCP

Escolha o seu cliente abaixo. Em todos os casos, substitua `/caminho/absoluto/para/mcp_mercadolivre` pelo caminho real da pasta (rode `pwd` dentro dela para descobrir).

### Claude Desktop

Arquivo de configuração:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Conteúdo (se o arquivo já existir, adicione só a entrada `"mercadolivre"` dentro de `mcpServers`):

```json
{
  "mcpServers": {
    "mercadolivre": {
      "command": "node",
      "args": ["/caminho/absoluto/para/mcp_mercadolivre/dist/index.js"],
      "env": {
        "ML_CLIENT_ID": "seu_client_id",
        "ML_CLIENT_SECRET": "seu_client_secret",
        "ML_SITE_ID": "MLB"
      }
    }
  }
}
```

Feche e reabra o Claude Desktop completamente. As ferramentas aparecem pelo ícone de ferramentas na conversa.

### Cursor

Arquivo de configuração (crie se não existir):

- **Global** (todos os projetos): `~/.cursor/mcp.json`
- **Por projeto**: `.cursor/mcp.json` na pasta do projeto

Mesmo JSON do Claude Desktop acima. Depois: **Settings → MCP** e verifique se o servidor `mercadolivre` aparece como ativo (pode ser preciso clicar em refresh/restart).

### Kimi Code

Arquivo de configuração:

- **Global** (todos os projetos): `~/.kimi-code/mcp.json`
- **Por projeto**: `.kimi-code/mcp.json` na pasta do projeto

Mesmo JSON acima. Alternativamente, rode `/mcp-config` dentro do Kimi Code para adicionar de forma interativa, e `/mcp` para ver o status da conexão.

---

## Alternativa: Docker

Se preferir Docker em vez de Node local:

```bash
docker compose build
docker compose --profile auth run --rm --service-ports auth   # autenticação (equivale ao npm run auth)
docker compose run --rm mcp-mercadolivre                      # teste manual do servidor
```

E no cliente MCP, use a variante Docker do JSON (veja [Execução via Docker no README](../README.md#execução-via-docker)). Os tokens ficam no volume `meli-data`, compartilhado entre a autenticação e o servidor.

---

## Primeiros comandos para testar

Abra uma conversa nova no seu cliente e experimente pedir:

- **"Liste meus anúncios ativos"** → usa `get_my_items`
- **"Quais perguntas eu tenho sem resposta?"** → usa `get_questions` com `UNANSWERED`
- **"Mostre meus últimos 5 pedidos"** → usa `get_orders`
- **"Como está minha reputação no Mercado Livre?"** → usa `get_seller_reputation`
- **"Busque o preço médio de 'cafeteira espresso' no Mercado Livre"** → usa `search_products`
- **"Quero anunciar um iPhone 13 128GB. Me ajude a criar o anúncio"** → o assistente segue o fluxo `predict_category` → `get_category_attributes` → `create_item` (confirme os dados antes de publicar!)

> Dica: ferramentas de escrita (criar anúncio, responder perguntas, enviar mensagens) fazem alterações reais na sua conta. O assistente foi instruído a pedir confirmação, mas sempre revise antes de aprovar.

## Problemas?

Consulte a seção [Solução de problemas do README](../README.md#solução-de-problemas) — cobre redirect URI rejeitada, tokens expirados, erros 401, erros de escopo (Ads/Full/Shops) e erros de validação na criação de anúncios. Veja também a seção [Segurança](../README.md#segurança) para o modo somente leitura e os perfis de ferramentas — úteis enquanto você ganha confiança com a ferramenta.
