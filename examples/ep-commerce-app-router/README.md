# EP Commerce storefront (App Router)

Reference storefront for `@elasticpath/plasmic-ep-commerce-elastic-path`. It
mirrors a real consumer install: the Plasmic and Elastic Path packages resolve
from the registry, not from this monorepo.

## Running it

```bash
cp .env.local.example .env.local   # fill in EP_CLIENT_ID, CHECKOUT_SESSION_SECRET, …
yarn install
yarn dev                            # http://localhost:3456
```

The port matters. `lib/ep-auth.ts` defaults `baseURL` to `http://localhost:3456`,
and the origin gate rejects cart mutations from an origin that isn't trusted. To
serve elsewhere, set `NEXT_PUBLIC_BASE_URL`.

`plasmic-init.ts` points `host` at the Plasmic instance serving the project, so
that instance has to be reachable — a local `platform/wab` on `:3003` for local
development.

## Testing an unreleased package change

Registry versions can only ever exercise what has shipped. To run this app
against working-tree changes to the package, point the dependency at the local
source and rebuild it first:

```bash
# in plasmicpkgs/commerce-providers/elastic-path
yarn start                 # tsdx watch — a full `yarn build` takes ~28 minutes
node build-server.mjs      # only needed for the /server entry (esbuild, seconds)

# here
yarn add file:../../plasmicpkgs/commerce-providers/elastic-path
rm -rf .next               # Next caches across node_modules changes
```

Revert the `package.json` and `yarn.lock` changes before committing — this app
is meant to reflect what a customer installs.

> Under `next dev`, Next's RSC debug instrumentation serializes server-component
> locals — including the EP session and its access token — into the page source.
> That does not happen in `next build` output. Don't run a dev server on a shared
> host or against production Elastic Path credentials.
