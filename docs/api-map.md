# Mapa da API do Mercado Livre

Todos os endpoints são relativos a `https://api.mercadolibre.com` (exceto a autorização OAuth, em `https://auth.mercadolivre.com.br`). `{site}` = `ML_SITE_ID` (padrão `MLB`), `{me}` = id do vendedor autenticado via `GET /users/me`.

## Endpoints utilizados

| Método + Endpoint | Ferramenta(s) |
|---|---|
| `GET /sites/{site}/search` | `search_products` |
| `GET /items/{id}` | `get_item` |
| `GET /users/me` | usado por 16 ferramentas para resolver o seller id (`get_my_items`, `get_questions`, `get_orders`, `get_order_messages`, `send_message`, `get_claims`, `get_returns`, `get_seller_reputation`, `manage_question_blacklist`, `get_promotions`, `get_promotion_items`, `add_item_to_promotion`, `get_ads_campaigns`, `get_fulfillment_stock`, `get_mercado_shop`, `get_warehouses`) |
| `GET /users/{id}/items/search` | `get_my_items` |
| `GET /items?ids=...` (multiget) | `get_my_items` |
| `GET /questions/search` | `get_questions` |
| `GET /orders/search` | `get_orders` |
| `GET /sites/{site}/category_predictor/predict` | `predict_category` |
| `GET /categories/{id}/attributes` | `get_category_attributes` |
| `GET /sites/{site}/listing_types` | `get_listing_types` |
| `GET /sites/{site}/listing_prices` | `get_listing_prices` |
| `POST /items` | `create_item` |
| `PUT /items/{id}` | `update_item`, `update_item_status` |
| `POST /answers` | `answer_question` |
| `POST /pictures` | `upload_picture`, `upload_video` |
| `GET /shipments/{id}` | `get_shipment` |
| `GET /shipment_labels` | `get_shipment_label` |
| `GET /messages/packs/{order_id}/sellers/{me}` | `get_order_messages` |
| `POST /messages/packs/{order_id}/sellers/{me}` | `send_message` |
| `GET /orders/{order_id}` | `send_message` (descobrir o `buyer.id`) |
| `GET /post-purchase/claims/search` | `get_claims` |
| `GET /post-purchase/claims/{id}` | `get_claim_detail` |
| `GET /post-purchase/claims/{id}/messages` | `get_claim_detail` |
| `POST /post-purchase/claims/{id}/messages` | `send_claim_message` |
| `GET /post-purchase/returns/search` | `get_returns` |
| `GET /users/{id}` | `get_seller_reputation` |
| `GET /items/visits` | `get_item_visits` |
| `GET /products/search` | `search_catalog` |
| `GET /products/{id}` | `get_catalog_product` |
| `POST /items/catalog_listings` | `create_catalog_listing` |
| `GET /suggestions/items/{id}/details` | `get_price_suggestion` |
| `GET /trends/{site}`, `GET /trends/{site}/{category_id}` | `get_trends` |
| `GET /currency_conversions/search` | `convert_currency` |
| `GET /sites/{site}/categories` | `get_site_categories` |
| `GET /categories/{id}` | `get_category` |
| `GET /users/{me}/questions_blacklist` | `manage_question_blacklist` (list) |
| `POST /users/{user_id}/questions_blacklist` | `manage_question_blacklist` (block) |
| `DELETE /users/{user_id}/questions_blacklist` | `manage_question_blacklist` (unblock) |
| `GET /seller-promotions/promotions` | `get_promotions` |
| `GET /seller-promotions/promotions/{id}/items` | `get_promotion_items` |
| `POST /seller-promotions/items/{item_id}` | `add_item_to_promotion` |
| `GET /advertising/product_ads/campaigns` | `get_ads_campaigns` |
| `GET /advertising/product_ads/campaigns/{id}/metrics` | `get_ads_campaign_metrics` |
| `GET /fulfillment/stock` | `get_fulfillment_stock` |
| `GET /users/{me}/shop` | `get_mercado_shop` |
| `GET /shops/search` | `get_mercado_shop` (fallback) |
| `GET /user-warehouses` | `get_warehouses` |
| `GET https://auth.mercadolivre.com.br/authorization` | fluxo OAuth (`auth-cli`) |
| `POST /oauth/token` | fluxo OAuth (`auth-cli`, refresh em `auth.ts`) |

## Cobertura

### Áreas cobertas

- **Busca e itens**: search público, detalhe, multiget, visitas
- **Publicação de anúncios**: category predictor, atributos obrigatórios, tipos/taxas de anúncio, criação, upload de mídia (foto/vídeo)
- **Gestão de anúncios**: atualização de preço/estoque/título/vídeo, pausa/ativação/fechamento
- **Perguntas**: busca, resposta, blacklist
- **Pedidos e envios**: busca de pedidos, detalhe do envio, etiqueta (PDF/ZPL2)
- **Mensageria pós-venda**: leitura e envio (orders + claims)
- **Pós-compra (v2)**: reclamações e devoluções
- **Reputação e métricas**: termômetro do vendedor, visitas por anúncio
- **Catálogo**: busca de produtos, buy box, opt-in de anúncio
- **Preço e mercado**: sugestão de preço, tendências, câmbio
- **Categorias**: navegação pela árvore e configurações
- **Promoções**: campanhas, itens participantes, inscrição de itens
- **Mercado Ads (Product Ads)**: campanhas e métricas (somente leitura)
- **Fulfillment (Full)**: consulta de estoque
- **Mercado Shops & depósitos**: dados da loja e origens de estoque

### Áreas intencionalmente não cobertas

- **Webhooks / notificações**: exigem um endpoint HTTPS público para receber callbacks — fora do escopo de um servidor MCP local (stdio). O modelo aqui é pull (o LLM consulta sob demanda).
- **Mercado Pago / pagamentos**: escopo financeiro separado, com credenciais e APIs próprias.
- **Mercado Envios Flex / logística própria**: configuração operacional específica de cada conta.
- **Gestão de campanhas de Ads (escrita)**: criar/pausar campanhas e alterar orçamento ficou de fora deliberadamente — apenas leitura, para evitar alterações de gasto publicitário por comando de voz/texto.
- **Moderação e reputação de compradores**: endpoints administrativos não relacionados à operação do vendedor.
- **Classificados (imóveis/veículos/serviços)**: fluxo de anúncio distinto, com regras próprias.
- **Multi-conta**: o servidor opera uma única conta autenticada por instalação (um `tokens.json`).
