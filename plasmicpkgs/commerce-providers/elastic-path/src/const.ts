export const ELASTICPATH_COOKIE_EXPIRE = 30

export const ELASTICPATH_CART_COOKIE = 'elasticpath_cart'

export const ELASTICPATH_CUSTOMER_COOKIE = 'elasticpath_customer'

export const ELASTICPATH_WISHLIST_COOKIE = 'elasticpath_wishlist'

// --- Timing defaults ---

/** Default debounce delay for cart quantity updates and bundle configuration API calls. */
export const DEFAULT_DEBOUNCE_MS = 500

/** Delay before focusing the cart drawer after open, allowing CSS transitions to complete. */
export const FOCUS_TRAP_DELAY_MS = 50

// --- Stock threshold defaults ---

/** Stock level at or below which items are considered "low stock". */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5

/** Stock level at or below which items are considered "limited stock" (above low, below plentiful). */
export const DEFAULT_MEDIUM_STOCK_THRESHOLD = 20

// --- SWR caching intervals ---

/** 1 minute — used for stock data and bundle product metadata that can change with purchases. */
export const SWR_DEDUPING_INTERVAL_SHORT = 60 * 1000

/** 5 minutes — used for location data that rarely changes. */
export const SWR_DEDUPING_INTERVAL_LONG = 5 * 60 * 1000

// --- Currency defaults ---

/** Fallback currency code when the cart or order has no currency set. */
export const DEFAULT_CURRENCY_CODE = 'USD'

// --- Server-cart architecture ---

/** httpOnly cookie name for server-managed cart identity. */
export const EP_CART_COOKIE_NAME = 'ep_cart'

/** Header name for ShopperContext overrides (Studio preview, checkout URL). */
export const SHOPPER_CONTEXT_HEADER = 'x-shopper-context'
