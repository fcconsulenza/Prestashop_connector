# FC AI PrestaShop Connector

Read-only MCP gateway between ChatGPT/OpenAI and PrestaShop 8 Webservice.

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
