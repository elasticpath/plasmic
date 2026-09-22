import { describe, expect, it } from "vitest";
import {
  ACCOUNT_ROLL_THRESHOLD_SECONDS,
  EP_ACCOUNT_TOKEN_HEADER,
  ENVELOPE_LIFETIME_SECONDS,
  accountNeedsRoll,
  accountTokenHeaders,
  applyAccountLapse,
  clearAccount,
  holdAnchorToken,
  identifyMember,
  parseEpExpires,
  readEnvelopeAccount,
  selectAccount,
} from "../envelope";

const NOW = 1_780_000_000;

const BASE = {
  id: "sess-1",
  userId: "anon-1",
  epAccessToken: "shopper-token",
  epCartId: "cart-1",
};

const ACCOUNT = {
  id: "acct-1",
  name: "Acme Industrial",
  token: "account-management-token",
  expires: NOW + 3600,
};

describe("parseEpExpires", () => {
  it("accepts the ISO-8601 timestamp Elastic Path returns", () => {
    expect(parseEpExpires("2026-05-29T12:00:00.000Z")).toBe(
      Math.floor(Date.parse("2026-05-29T12:00:00.000Z") / 1000)
    );
  });

  it("accepts EP's offset-bearing ISO form", () => {
    expect(parseEpExpires("2026-05-29T13:00:00+01:00")).toBe(
      Math.floor(Date.parse("2026-05-29T13:00:00+01:00") / 1000)
    );
  });

  it("accepts epoch seconds", () => {
    expect(parseEpExpires(NOW)).toBe(NOW);
  });

  it("rejects a value that is neither", () => {
    expect(parseEpExpires("next tuesday")).toBeNull();
    expect(parseEpExpires(undefined)).toBeNull();
    expect(parseEpExpires(null)).toBeNull();
    expect(parseEpExpires({})).toBeNull();
  });
});

describe("selectAccount", () => {
  it("writes the member and the selected account as one group", () => {
    const next = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    expect(next.epMemberId).toBe("member-1");
    expect(next.epAccount).toEqual(ACCOUNT);
  });

  it("leaves the rest of the envelope untouched", () => {
    const next = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    expect(next.epAccessToken).toBe("shopper-token");
    expect(next.epCartId).toBe("cart-1");
  });

  it("drops the anchor token, so the two slots are never both filled", () => {
    const anchored = holdAnchorToken(BASE, {
      memberId: "member-1",
      anchor: { token: "anchor-token", expires: NOW + 3600 },
    });

    const next = selectAccount(anchored, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    expect(next.epAnchorToken).toBeUndefined();
    expect("epAnchorToken" in next).toBe(false);
  });

  it("clears a prior lapse, because an account is selected again", () => {
    const lapsed = applyAccountLapse(
      selectAccount(BASE, {
        memberId: "member-1",
        account: { ...ACCOUNT, expires: NOW - 1 },
      }),
      NOW
    );
    expect(lapsed.epLapsedAccount).toBeDefined();

    const next = selectAccount(lapsed, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    expect("epLapsedAccount" in next).toBe(false);
  });
});

describe("holdAnchorToken", () => {
  it("drops the selected account, so the two slots are never both filled", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    const next = holdAnchorToken(selected, {
      memberId: "member-1",
      anchor: { token: "anchor-token", expires: NOW + 3600 },
    });

    expect("epAccount" in next).toBe(false);
    expect(next.epAnchorToken).toEqual({
      token: "anchor-token",
      expires: NOW + 3600,
    });
  });

  it("keeps the member, because holding an anchor is still signed in", () => {
    const next = holdAnchorToken(BASE, {
      memberId: "member-1",
      anchor: { token: "anchor-token", expires: NOW + 3600 },
    });

    expect(next.epMemberId).toBe("member-1");
  });
});

describe("clearAccount", () => {
  it("removes every account slot and the member", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    const next = clearAccount(selected);

    expect("epMemberId" in next).toBe(false);
    expect("epAccount" in next).toBe(false);
    expect("epAnchorToken" in next).toBe(false);
    expect("epLapsedAccount" in next).toBe(false);
    expect(next.epAccessToken).toBe("shopper-token");
  });
});

describe("applyAccountLapse", () => {
  it("states the lapse as a fact, carrying the id and name forward", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: { ...ACCOUNT, expires: NOW - 1 },
    });

    const next = applyAccountLapse(selected, NOW);

    expect(next.epLapsedAccount).toEqual({
      id: ACCOUNT.id,
      name: ACCOUNT.name,
    });
  });

  it("takes the credential away with the same move", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: { ...ACCOUNT, expires: NOW - 1 },
    });

    const next = applyAccountLapse(selected, NOW);

    expect("epAccount" in next).toBe(false);
    expect(JSON.stringify(next)).not.toContain(ACCOUNT.token);
  });

  it("keeps the member signed in", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: { ...ACCOUNT, expires: NOW - 1 },
    });

    expect(applyAccountLapse(selected, NOW).epMemberId).toBe("member-1");
  });

  it("leaves a live account alone", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    const next = applyAccountLapse(selected, NOW);

    expect(next.epAccount).toEqual(ACCOUNT);
    expect("epLapsedAccount" in next).toBe(false);
  });

  it("leaves a session with no account alone", () => {
    expect(applyAccountLapse(BASE, NOW)).toEqual(BASE);
  });

  it("lapses an expired anchor token the same way", () => {
    const anchored = holdAnchorToken(BASE, {
      memberId: "member-1",
      anchor: { token: "anchor-token", expires: NOW - 1 },
    });

    const next = applyAccountLapse(anchored, NOW);

    expect("epAnchorToken" in next).toBe(false);
    expect(next.epMemberId).toBe("member-1");
  });
});

describe("readEnvelopeAccount", () => {
  it("reads the member, the account and the lapse off the envelope", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });

    expect(readEnvelopeAccount(selected)).toEqual({
      memberId: "member-1",
      account: ACCOUNT,
      lapsedAccount: null,
    });
  });

  it("reports no account when only an anchor is held", () => {
    const anchored = holdAnchorToken(BASE, {
      memberId: "member-1",
      anchor: { token: "anchor-token", expires: NOW + 3600 },
    });

    expect(readEnvelopeAccount(anchored)).toEqual({
      memberId: "member-1",
      account: null,
      lapsedAccount: null,
    });
  });

  it("returns an empty reading for a null session", () => {
    expect(readEnvelopeAccount(null)).toEqual({
      memberId: undefined,
      account: null,
      lapsedAccount: null,
    });
  });
});

describe("accountTokenHeaders", () => {
  it("sends the account-management header when an account is selected", () => {
    expect(accountTokenHeaders({ accountToken: "account-token" })).toEqual({
      [EP_ACCOUNT_TOKEN_HEADER]: "account-token",
    });
  });

  it("sends nothing when no account is selected", () => {
    expect(accountTokenHeaders({})).toEqual({});
    expect(accountTokenHeaders({ accountToken: "" })).toEqual({});
    expect(accountTokenHeaders(undefined)).toEqual({});
  });
});

describe("ENVELOPE_LIFETIME_SECONDS", () => {
  it("matches the cart's seven-day clock, not better-auth's five minutes", () => {
    expect(ENVELOPE_LIFETIME_SECONDS).toBe(60 * 60 * 24 * 7);
  });
});

describe("identifyMember", () => {
  it("signs the member in with no account and no credential", () => {
    const next = identifyMember(BASE, "member-1");
    expect(next.epMemberId).toBe("member-1");
    expect(next.epAccount).toBeUndefined();
    expect(next.epAnchorToken).toBeUndefined();
  });

  it("drops a prior selection, so re-authenticating cannot inherit one", () => {
    const selected = selectAccount(BASE, {
      memberId: "member-1",
      account: ACCOUNT,
    });
    const next = identifyMember(selected, "member-2");
    expect(next.epMemberId).toBe("member-2");
    expect(next.epAccount).toBeUndefined();
    expect(JSON.stringify(next)).not.toContain(ACCOUNT.token);
  });
});

describe("accountNeedsRoll", () => {
  it("rolls inside the implicit token's own lifetime", () => {
    expect(
      accountNeedsRoll({ ...ACCOUNT, expires: NOW + 3599 }, NOW)
    ).toBe(true);
  });

  it("leaves a token with more than that remaining alone", () => {
    expect(
      accountNeedsRoll(
        { ...ACCOUNT, expires: NOW + ACCOUNT_ROLL_THRESHOLD_SECONDS + 1 },
        NOW
      )
    ).toBe(false);
  });

  it("does not roll an expired token, which no longer mints anything", () => {
    expect(accountNeedsRoll({ ...ACCOUNT, expires: NOW }, NOW)).toBe(false);
  });

  it("has nothing to roll with no account selected", () => {
    expect(accountNeedsRoll(null, NOW)).toBe(false);
  });
});
