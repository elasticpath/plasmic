/** Compiled by `types.test.ts`; nothing imports this. */
import { createEpIdentityClient } from "../../client";

const identity = createEpIdentityClient();

// @ts-expect-error the auth handler is always at /api/ep
createEpIdentityClient({ basePath: "/api/store" });

// A caller cannot name a route.
// @ts-expect-error there is no URL to pass
identity.logout("/api/ep/ep/account/logout");

// Credentials are the argument, and their shape comes from the endpoint.
identity.login({ username: "buyer@example.com", password: "pw" });
// @ts-expect-error password is required
identity.login({ username: "buyer@example.com" });
// @ts-expect-error the endpoint reads `username`, not `user`
identity.login({ user: "buyer@example.com", password: "pw" });

identity.register({
  username: "buyer",
  password: "pw",
  name: "Buyer",
  email: "buyer@example.com",
});
// @ts-expect-error email is required
identity.register({ username: "buyer", password: "pw", name: "Buyer" });

// Paging is optional; the operation is not.
identity.roster();
identity.roster({ limit: 10, offset: 20 });

identity.member();
// @ts-expect-error the server chooses the member; the browser sends nothing
identity.member({ memberId: "member-1" });

identity.accountAddresses();
// @ts-expect-error the server chooses the account; the browser sends nothing
identity.accountAddresses({ accountId: "acct-1" });

identity.createAccountAddress({ line_1: "1 High Street", country: "GB" });
// @ts-expect-error the address object is required
identity.createAccountAddress();
// @ts-expect-error the server chooses the account
identity.createAccountAddress({ accountId: "acct-1", line_1: "1 High Street" });
// @ts-expect-error the server chooses the address id
identity.createAccountAddress({ id: "addr-1", line_1: "1 High Street" });
// @ts-expect-error the server sets the address type
identity.createAccountAddress({ type: "address", line_1: "1 High Street" });
// @ts-expect-error tokens stay on the server
identity.createAccountAddress({ token: "secret", line_1: "1 High Street" });
// @ts-expect-error account tokens stay on the server
identity.createAccountAddress({ accountToken: "secret", line_1: "1 High Street" });
// @ts-expect-error filters stay on the server
identity.createAccountAddress({ filter: "eq(country,GB)", line_1: "1 High Street" });
// @ts-expect-error line 3 is not a saved-address field
identity.createAccountAddress({ line_3: "Floor 2", line_1: "1 High Street" });
// @ts-expect-error relationships stay on the server
identity.createAccountAddress({ relationships: {}, line_1: "1 High Street" });

identity.deleteAccountAddress({ id: "addr-1" });
// @ts-expect-error the address id is required
identity.deleteAccountAddress();
// @ts-expect-error the server chooses the account
identity.deleteAccountAddress({ id: "addr-1", accountId: "acct-1" });
// @ts-expect-error tokens stay on the server
identity.deleteAccountAddress({ id: "addr-1", token: "secret" });
// @ts-expect-error account tokens stay on the server
identity.deleteAccountAddress({ id: "addr-1", accountToken: "secret" });
// @ts-expect-error the account path stays on the server
identity.deleteAccountAddress({ id: "addr-1", path: "/v2/accounts/acct-1/addresses/addr-1" });
// @ts-expect-error SDK options stay on the server
identity.deleteAccountAddress({ id: "addr-1", client: {} });

identity.updateAccountAddress({ id: "addr-1", city: "Manchester" });
identity.updateAccountAddress({ id: "addr-1", phone_number: "" });
// @ts-expect-error the address id is required
identity.updateAccountAddress({ city: "Manchester" });
// @ts-expect-error the server chooses the account
identity.updateAccountAddress({ id: "addr-1", accountId: "acct-1", city: "Manchester" });
// @ts-expect-error tokens stay on the server
identity.updateAccountAddress({ id: "addr-1", token: "secret", city: "Manchester" });
// @ts-expect-error account tokens stay on the server
identity.updateAccountAddress({ id: "addr-1", accountToken: "secret", city: "Manchester" });
// @ts-expect-error the account path stays on the server
identity.updateAccountAddress({ id: "addr-1", path: "/v2/accounts/acct-1/addresses/addr-1", city: "Manchester" });
// @ts-expect-error the server sets the address type
identity.updateAccountAddress({ id: "addr-1", type: "address", city: "Manchester" });
// @ts-expect-error SDK options stay on the server
identity.updateAccountAddress({ id: "addr-1", client: {}, city: "Manchester" });
// @ts-expect-error filters stay on the server
identity.updateAccountAddress({ id: "addr-1", filter: "eq(country,GB)", city: "Manchester" });
// @ts-expect-error line 3 is not a saved-address field
identity.updateAccountAddress({ id: "addr-1", line_3: "Floor 2", city: "Manchester" });
// @ts-expect-error relationships stay on the server
identity.updateAccountAddress({ id: "addr-1", relationships: {}, city: "Manchester" });

identity.updateMember({ name: "Ada Lovelace" });
identity.updateMember({ email: "ada@example.com" });
// @ts-expect-error the server chooses the member; the browser sends no id
identity.updateMember({ memberId: "member-1" });

// Deselecting is passing null, not omitting the field.
identity.selectAccount({ accountId: "acct-1" });
identity.selectAccount({ accountId: null });
// @ts-expect-error an account id is a string or null
identity.selectAccount({ accountId: 7 });

export async function readsWhatIsReleased() {
  const { session } = await identity.signInAnonymously();
  return { account: session.epAccount?.name, expires: session.epExpires };
}

export async function cannotReadOrSetTheCart() {
  const { session } = await identity.signInAnonymously();
  // @ts-expect-error the cart id stays on the server
  identity.setCart({ cartId: "cart-1" });
  // @ts-expect-error the handler withholds the cart id
  return session.epCartId;
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
