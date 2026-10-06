# Shopper journey

Seam 3 of elasticpath/plasmic#553. One journey, in a real browser, against a
running storefront and a real store. Its spine is a single assertion: no
request leaves the browser for an Elastic Path API host.

It needs a storefront and a store, so it does not run in CI.

```bash
npm install && npx playwright install chromium

# In another shell, with examples/ep-commerce-app-router/.env.local configured:
cd ../../../../examples/ep-commerce-app-router && npx next dev -p 3466

EP_E2E_ACCOUNT_USERNAME=... EP_E2E_ACCOUNT_PASSWORD=... npx playwright test
```

| Variable | Meaning |
| --- | --- |
| `EP_E2E_BASE_URL` | Storefront origin. Default `http://localhost:3466`. |
| `EP_E2E_ACCOUNT_USERNAME` / `_PASSWORD` | An account member who belongs to **two** accounts. Without these the journey skips. |
| `EP_E2E_LISTING_PATH` | Category page. Default `/product-list`. |
| `EP_E2E_PRODUCT_PATH` | Product page visited before the add. Default `/products/072541c8-1558-440b-979e-05b7880128fa`. |
| `EP_E2E_ADD_PRODUCT` / `EP_E2E_ADD_LOCATION` | What goes in the basket, and the stock location it comes from. |
| `EP_E2E_PRICED_SKU` | SKU whose price is bound to one of the two accounts. Default `sandlesm`. |
| `EP_E2E_REFINE_QUERY` | Search term the refinement step narrows with. Default `Sandle`. |
| `EP_E2E_REVISIT_WAIT_MS` | How long to wait before the return visit. Default 0 — see the step's note. |
| `EP_E2E_EP_HOSTS` | Extra Elastic Path API hostnames to count as violations. |
