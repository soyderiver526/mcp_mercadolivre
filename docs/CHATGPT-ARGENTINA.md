# ChatGPT + Render — cuenta de vendedor Argentina

Esta adaptación agrega Streamable HTTP y OAuth para ChatGPT al servidor original.
No es un producto oficial de Mercado Libre. Se probó con respuestas simuladas;
cada herramienta debe comprobarse con la cuenta real.

## Servicio separado en Render

- Repositorio: esta copia, rama main.
- Runtime: Node; Node 22.
- Build: pnpm install --frozen-lockfile --ignore-scripts && pnpm run build
- Start: node dist/http-server.js
- Health check: /health
- Una instancia. No usar réplicas.

Variables (cargar las claves solo en Environment de Render):

| Variable | Valor |
|---|---|
| ML_SITE_ID | MLA |
| ML_CLIENT_ID | 5576066816151069 |
| ML_CLIENT_SECRET | secreto de la aplicación, nunca en GitHub o chat |
| ML_OWNER_ID | ID numérico del vendedor autorizado; no es el App ID |
| PUBLIC_BASE_URL | URL HTTPS asignada al servicio nuevo, sin /mcp |
| ML_REDIRECT_URI | URL del servicio nuevo + /oauth/callback |
| ML_TOKENS_FILE | /tmp/meli-tokens.json |
| ML_TOOL_PROFILE | all |
| ML_READ_ONLY | true para primera prueba; false para habilitar escritura |
| NODE_VERSION | 22 |

Agregar ML_REDIRECT_URI como dirección adicional en DevCenter, manteniendo
la dirección del conector anterior. El proyecto original sugiere localhost HTTP;
la guía vigente de Mercado Libre requiere HTTPS.

## Conectar a ChatGPT

Plugins → + → Add custom MCP server. URL: PUBLIC_BASE_URL + /mcp.
Elegir OAuth con registro dinámico (DCR), sin introducir el Client Secret de
Mercado Libre en ChatGPT. Instalar el plugin y conectar. La pantalla de consentimiento
muestra el vendedor permitido y el alcance de las herramientas. Luego se inicia
sesión directamente en Mercado Libre Argentina.

El servidor rechaza cuentas cuyo ID no coincida con ML_OWNER_ID.
Los tokens de Mercado Libre permanecen en Render; ChatGPT recibe tokens distintos.
Los códigos son de un solo uso, se comprueba state y PKCE en ambos tramos y
se requiere autorización para /mcp. Solo se aceptan retornos HTTPS a
chatgpt.com o chat.openai.com.

## Límite de esta prueba

Las conexiones OAuth se guardan en memoria y el archivo de Mercado Libre vive
en /tmp. Tras reiniciar o redesplegar Render habrá que reconectar desde ChatGPT;
no es una instalación con persistencia de producción. No contratar almacenamiento
de pago sin decidirlo explícitamente.

Primero verificar get_my_items y get_orders. Habilitar escritura solo después
de comprobar la cuenta, refrescar las herramientas en ChatGPT y revisar cada
cambio concreto antes de ejecutarlo. No probar escritura con una publicación
real sin aprobación de sus valores.

## Pruebas

pnpm run build
node tests/http-auth.mjs

La prueba usa cuenta y credenciales ficticias y no envía operaciones a Mercado Libre.
