/**
 * The checkout email rule. Elastic Path refuses a checkout whose customer
 * email it cannot parse as one RFC 5322 address, and it does so after a cart
 * PaymentIntent has charged the card. This parser accepts and refuses what
 * the integration store was measured to accept and refuse, so a refusal here
 * happens before any payment and never stops an email Elastic Path takes.
 */
import type { SessionResponse } from "./types";

const SPECIALS = new Set(["(", ")", "<", ">", "[", "]", ":", ";", "@", "\\", ",", '"']);

function isVchar(c: string): boolean {
  return (c >= "!" && c <= "~") || c.codePointAt(0)! >= 0x80;
}

function isAtext(c: string, dot: boolean): boolean {
  if (c === ".") return dot;
  return !SPECIALS.has(c) && isVchar(c);
}

function isWsp(c: string): boolean {
  return c === " " || c === "\t";
}

function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return (
    parts.length === 4 &&
    parts.every((p) => /^(0|[1-9]\d{0,2})$/.test(p) && Number(p) <= 255)
  );
}

function isIP(s: string): boolean {
  if (isIPv4(s)) return true;
  if (!s.includes(":")) return false;
  let rest = s;
  const lastColon = rest.lastIndexOf(":");
  const tail = rest.slice(lastColon + 1);
  if (tail.includes(".")) {
    if (!isIPv4(tail)) return false;
    rest = `${rest.slice(0, lastColon + 1)}0:0`;
  }
  const halves = rest.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h === "" ? [] : h.split(":")));
  if (!groups.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

const KNOWN_CHARSETS = new Set(["utf-8", "iso-8859-1", "us-ascii"]);

function decodes(encoding: string, text: string): boolean {
  if (encoding === "b" || encoding === "B") {
    return /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text);
  }
  if (encoding !== "q" && encoding !== "Q") return false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=") {
      if (i + 2 >= text.length || !/^[0-9a-fA-F]{2}$/.test(text.slice(i + 1, i + 3))) {
        return false;
      }
      i += 2;
    } else if (!((c >= " " && c <= "~") || c === "\n" || c === "\r" || c === "\t")) {
      return false;
    }
  }
  return true;
}

/** An RFC 2047 encoded word in a character set the parser cannot read. */
function hasUnreadableCharset(word: string): boolean {
  if (word.length < 8 || !word.startsWith("=?") || !word.endsWith("?=")) return false;
  if (word.split("?").length !== 5) return false;
  const [charset, encoding, text] = word.slice(2, -2).split("?");
  if (!charset || encoding.length !== 1 || !decodes(encoding, text)) return false;
  return !KNOWN_CHARSETS.has(charset.toLowerCase());
}

class Fail extends Error {}

class AddressParser {
  constructor(private s: string) {}

  empty(): boolean {
    return this.s.length === 0;
  }

  peek(): string {
    return this.s[0];
  }

  consume(c: string): boolean {
    if (this.s[0] !== c) return false;
    this.s = this.s.slice(1);
    return true;
  }

  skipSpace(): void {
    while (!this.empty() && isWsp(this.peek())) this.s = this.s.slice(1);
  }

  skipCFWS(): boolean {
    this.skipSpace();
    while (this.consume("(")) {
      if (this.consumeComment() === null) return false;
      this.skipSpace();
    }
    return true;
  }

  consumeComment(): string | null {
    let depth = 1;
    let comment = "";
    while (!this.empty() && depth > 0) {
      if (this.peek() === "\\" && this.s.length > 1) {
        this.s = this.s.slice(1);
      } else if (this.peek() === "(") {
        depth++;
      } else if (this.peek() === ")") {
        depth--;
      }
      if (depth > 0) comment += this.s[0];
      this.s = this.s.slice(1);
    }
    return depth === 0 ? comment : null;
  }

  consumeAtom(dot: boolean, permissive: boolean): string {
    const chars = Array.from(this.s);
    let n = 0;
    while (n < chars.length && isAtext(chars[n], dot)) n++;
    if (n === 0) throw new Fail();
    const atom = chars.slice(0, n).join("");
    this.s = chars.slice(n).join("");
    if (!permissive && (atom.startsWith(".") || atom.endsWith(".") || atom.includes(".."))) {
      throw new Fail();
    }
    return atom;
  }

  consumeQuotedString(): string {
    const chars = Array.from(this.s);
    let out = "";
    let escaped = false;
    for (let i = 1; ; i++) {
      const c = chars[i];
      if (c === undefined) throw new Fail();
      if (escaped) {
        if (!isVchar(c) && !isWsp(c)) throw new Fail();
        out += c;
        escaped = false;
      } else if (c === '"') {
        this.s = chars.slice(i + 1).join("");
        return out;
      } else if (c === "\\") {
        escaped = true;
      } else if (isVchar(c) || isWsp(c)) {
        out += c;
      } else {
        throw new Fail();
      }
    }
  }

  consumeDomainLiteral(): void {
    this.consume("[");
    const end = this.s.indexOf("]");
    if (end < 0) throw new Fail();
    const dtext = this.s.slice(0, end);
    if (!isIP(dtext)) throw new Fail();
    this.s = this.s.slice(end + 1);
  }

  consumeAddrSpec(): boolean {
    const orig = this.s;
    try {
      this.skipSpace();
      if (this.empty()) throw new Fail();
      if (this.peek() === '"') {
        if (this.consumeQuotedString() === "") throw new Fail();
      } else {
        this.consumeAtom(true, false);
      }
      if (!this.consume("@")) throw new Fail();
      this.skipSpace();
      if (this.empty()) throw new Fail();
      if (this.peek() === "[") {
        this.consumeDomainLiteral();
      } else {
        this.consumeAtom(true, false);
      }
      return true;
    } catch (err) {
      if (!(err instanceof Fail)) throw err;
      this.s = orig;
      return false;
    }
  }

  consumePhrase(): void {
    let words = 0;
    for (;;) {
      if (words > 0 && !this.skipCFWS()) throw new Fail();
      this.skipSpace();
      if (this.empty()) break;
      try {
        if (this.peek() === '"') {
          this.consumeQuotedString();
        } else if (hasUnreadableCharset(this.consumeAtom(true, true))) {
          throw new Fail();
        }
      } catch (err) {
        if (!(err instanceof Fail)) throw err;
        break;
      }
      words++;
    }
    if (words === 0) throw new Fail();
  }

  /** Returns how many addresses it read (a group can hold any number). */
  parseAddress(handleGroup: boolean): number {
    this.skipSpace();
    if (this.empty()) throw new Fail();
    if (this.consumeAddrSpec()) {
      this.skipSpace();
      if (!this.empty() && this.peek() === "(") {
        this.consume("(");
        const comment = this.consumeComment();
        if (comment === null) throw new Fail();
        if (comment.split(/[ \t]+/).some(hasUnreadableCharset)) throw new Fail();
      }
      return 1;
    }
    if (this.peek() !== "<") this.consumePhrase();
    this.skipSpace();
    if (handleGroup && this.consume(":")) return this.consumeGroupList();
    if (!this.consume("<")) throw new Fail();
    if (!this.consumeAddrSpec()) throw new Fail();
    if (!this.consume(">")) throw new Fail();
    return 1;
  }

  consumeGroupList(): number {
    let count = 0;
    this.skipSpace();
    if (this.consume(";")) {
      if (!this.skipCFWS()) throw new Fail();
      return count;
    }
    for (;;) {
      this.skipSpace();
      count += this.parseAddress(false);
      if (!this.skipCFWS()) throw new Fail();
      if (this.consume(";")) {
        if (!this.skipCFWS()) throw new Fail();
        return count;
      }
      if (!this.consume(",")) throw new Fail();
    }
  }
}

/** True when Elastic Path accepts `value` as a checkout customer email. */
export function isCheckoutEmail(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parser = new AddressParser(value);
  try {
    const count = parser.parseAddress(true);
    return parser.skipCFWS() && parser.empty() && count === 1;
  } catch (err) {
    if (err instanceof Fail) return false;
    throw err;
  }
}

export function invalidEmail(): SessionResponse {
  return {
    status: 400,
    body: {
      success: false,
      error: {
        code: "INVALID_EMAIL",
        message: "Enter a valid email address, such as name@example.com.",
      },
    },
  };
}
