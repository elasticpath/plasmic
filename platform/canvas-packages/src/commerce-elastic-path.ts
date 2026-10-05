// Never import the package's `./server` subpath or its `ep.*` functions here.
// hostLessRegistry wins on an id collision, which would move every consumer's
// data-query panel into the hostless about:blank realm with no error anywhere.
import { registerAll } from "@elasticpath/plasmic-ep-commerce-elastic-path";

export function register() {
  registerAll();
}
register();
