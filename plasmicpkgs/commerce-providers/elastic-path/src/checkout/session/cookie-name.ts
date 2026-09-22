/**
 * The checkout session's cookie name, in its own module so the auth plugin can
 * tear the session down on an account switch without importing the Node-only
 * store that writes it.
 */
export const CHECKOUT_SESSION_COOKIE_NAME = "ep_checkout_session";
