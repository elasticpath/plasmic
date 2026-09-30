// Only `registerAll` — never anything from the package's `./server` subpath,
// and never its `ep.*` custom functions. `hostLessRegistry` is spread second
// in Studio and wins on an id collision, so one such import would move every
// consumer's data-query Configure panel into the hostless `about:blank` realm
// and its `<base href>`-rewritten URLs, leaving the canvas unaffected and
// raising no error anywhere. See ADR-0003 in the package's docs/adr/.
import { registerAll } from "@elasticpath/plasmic-ep-commerce-elastic-path";

export function register() {
  registerAll();
}
register();
