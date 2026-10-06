# FC AI PrestaShop Connector

Read-only MCP gateway between ChatGPT/OpenAI and the PrestaShop Webservice.

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

No customer PII is exposed. No write operation is implemented.

## PrestaShop
Create a dedicated Webservice key named FC AI READ and grant GET only to:
- products
- stock_availables
- orders

Keep API keys exclusively in server environment variables.
