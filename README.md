# FC AI PrestaShop Connector

MCP gateway between ChatGPT/OpenAI and the PrestaShop Webservice, with scoped and confirmed writes.

## Stores and credentials

The store list is configured in `src/config.js`. API keys belong exclusively in Render environment variables. A store being listed does not mean its credentials are present or its connection has passed a test.

| Store ID | Store | Canonical URL | Render secret variable |
| --- | --- | --- | --- |
| adipietro | Adipietro Commerciale | https://adipietro.it | PS_KEY_ADIPIETRO |
| cartoschool | Cartoschool | https://cartoschool.it | PS_KEY_CARTOSCHOOL |
| le3c | Le 3C Giocattoli | https://le3cgiocattoli.com | PS_KEY_LE3C |
| balita | Balita Store | https://balitastore.it | PS_KEY_BALITA |
| lacartoleria | laCartoleria | https://www.lacartoleria.it | PS_KEY_LACARTOLERIA |
| parafarmaciabembo | Parafarmacia Bembo | https://parafarmaciabembo.it | PS_KEY_PARAFARMACIABEMBO |
| silvanabomboniere | Silvana Bomboniere | https://silvanabomboniere.it | PS_KEY_SILVANABOMBONIERE |
| idecorativi | I Decorativi | https://idecorativi.it | PS_KEY_IDECORATIVI |
| golamifa | Golamifa | https://www.golamifa.it | PS_KEY_GOLAMIFA |
| presepiale | Presepiale | https://presepiale.it | PS_KEY_PRESEPIALE |
| frameinterni | Frame Interni | https://frameinterni.com | PS_KEY_FRAMEINTERNI |
| provenzalemotorstore | Provenzale Motor Store | https://provenzalemotorstore.it | PS_KEY_PROVENZALEMOTORSTORE |

New stores have an unspecified management fee (`null`); do not infer financial terms from the technical configuration. Sales summaries return a null fee amount until an agreed percentage is configured.

For each store, the owner creates a dedicated key named `FC MCP READ`, enables it, grants only GET on `products`, `stock_availables`, and `orders`, and selects the intended shop in multishop installations. Paste that key directly into its Render secret variable, never into chat or this repository. Preserve existing variables when saving the new ones.

After deployment, use `prestashop_list_stores`, `prestashop_test_connection`, and the product, stock, and order tools to verify each store. An HTTP 202 HTML browser challenge is a hosting protection issue; do not treat it as successful API access or disable authentication.

## Tools
- prestashop_list_stores
- prestashop_test_connection
- prestashop_list_products
- prestashop_low_stock
- prestashop_recent_orders
- prestashop_sales_summary

No customer PII is exposed by the order tools.

## Scoped writes (0.4.0)

Set `PS_WRITE_STORES` to a comma-separated list of store IDs, e.g. `lacartoleria`. Stores absent from this list remain read-only even when their key grants writes. Keep it empty until the owner has approved the permissions below.

| Resource | Permissions |
| --- | --- |
| products | GET, PATCH |
| stock_availables | GET, PATCH |
| orders | GET |
| order_states | GET |
| order_histories | POST |
| specific_prices | GET, POST, PATCH |

Preserve the key's identity; extend only this dedicated connector key. No PUT or DELETE is required. PATCH requires a supporting PrestaShop version (the current laCartoleria shop is 8.1.1); unsupported stores return an error, without a full-resource PUT fallback.

- `prestashop_order_states`: IDs, labels and workflow flags.
- `prestashop_list_discounts`: existing specific-price IDs and conditions for a product.
- `prestashop_preview_product_update`: price excluding tax, activation, reference/EAN, weight and localized name/descriptions/SEO. Localized updates need a language ID. Existing products only.
- `prestashop_preview_stock_update`: absolute quantity of a specific stock row, including combinations. Advanced warehouse-dependent stock is refused.
- `prestashop_preview_discount`: percentage (0–100) or tax-inclusive amount with explicit currency ID, for all customers in one explicit shop. Optional start/end dates use shop-local `YYYY-MM-DD HH:mm:ss`; omitted dates mean unlimited duration. Existing discounts require an explicit ID and must match the product/shop and general audience; quantity-specific or customer-specific discounts cannot be replaced by this tool. Setting reduction to zero neutralizes an existing discount, without deleting it.
- `prestashop_preview_order_state`: an order-state transition via `order_histories`, without requesting customer email. State hooks can still affect stock, invoices and third-party integrations.
- `prestashop_apply_preview`: signed preview token plus `confirm:true`, only after the user explicitly approves the exact before/after values and effects. Tokens expire after ten minutes; the record is re-read before writing and verified afterwards. Tokens are consumed before the write attempt. Uncertain outcomes must be inspected, never automatically retried.

The bearer token signs previews and never appears in preview contents. Replay protection is in memory, suitable for this single-instance service; changing the bearer invalidates outstanding previews. A restart resets the replay cache. The upstream Webservice has no atomic compare-and-swap: a small race between the pre-write read and the write remains. Do not use this design with multiple replicas without shared durable replay protection and concurrency coordination.

Tests use a simulated upstream and a real local MCP transport. Live write verification requires an owner-selected test record and explicit approval; configuring write support does not authorize changing a real product or order.

API references: [partial updates](https://devdocs.prestashop-project.org/8/webservice/getting-started/), [stock updates](https://devdocs.prestashop-project.org/8/webservice/tutorials/create-product-az/), [specific prices](https://devdocs.prestashop-project.org/8/webservice/resources/specific_prices/), [order history workflow](https://github.com/PrestaShop/PrestaShop/blob/8.1.1/classes/order/OrderHistory.php).

## PrestaShop
Create a dedicated Webservice key named FC AI READ and grant GET only to:
- products
- stock_availables
- orders

Keep API keys exclusively in server environment variables.
