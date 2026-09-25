/** Compiled by `types.test.ts`; nothing imports this. */
import { createEpIdentityClient } from "../../client";

const identity = createEpIdentityClient();

// A caller cannot name a route.
// @ts-expect-error there is no URL to pass
identity.logout("/api/ep/ep/account/logout");

// Credentials are the argument, and their shape comes from the endpoint.
identity.login({ username: "buyer@example.com", password: "pw" });
// @ts-expect-error password is required
identity.login({ username: "buyer@example.com" });
// @ts-expect-error the endpoint reads `username`, not `user`
identity.login({ user: "buyer@example.com", password: "pw" });

// Paging is optional; the operation is not.
identity.roster();
identity.roster({ limit: 10, offset: 20 });

// Deselecting is passing null, not omitting the field.
identity.selectAccount({ accountId: "acct-1" });
identity.selectAccount({ accountId: null });
// @ts-expect-error an account id is a string or null
identity.selectAccount({ accountId: 7 });

export async function readsWhatIsReleased() {
  const { session } = await identity.signInAnonymously();
  return { account: session.epAccount?.name, cart: session.epCartId };
}

export async function cannotReadACredential() {
  const { session } = await identity.signInAnonymously();
  return [
    // @ts-expect-error the handler withholds the access token
    session.epAccessToken,
    // @ts-expect-error the handler withholds the account's credential
    session.epAccount?.token,
    // @ts-expect-error the handler withholds the anchor token
    session.epAnchorToken,
    // @ts-expect-error the handler withholds the session token
    session.token,
  ];
}
