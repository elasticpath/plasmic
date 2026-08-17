# EP Commerce storefront (App Router)

Reference storefront for `@elasticpath/plasmic-ep-commerce-elastic-path`. It
mirrors a real consumer install: the Plasmic and Elastic Path packages resolve
from the registry, not from this monorepo.

> **Requires an unreleased package version.** This app uses
> `createEpAuthRoutes`, added in 0.3.0. Until 0.3.0 publishes, `yarn install`
> cannot resolve the dependency — use the local-source workflow below.

## Running it

```bash
cp .env.local.example .env.local   # fill in EP_CLIENT_ID, CHECKOUT_SESSION_SECRET, …
yarn install
yarn dev                            # http://localhost:3456
```

`yarn dev` serves 3456 deliberately. `lib/ep-auth.ts` defaults `baseURL` to
`http://localhost:3456`, and the origin gate rejects cart mutations from an
origin that isn't trusted — so a different port means silently failing writes.
To serve elsewhere, set `NEXT_PUBLIC_BASE_URL` to match.

`plasmic-init.ts` points `host` at the Plasmic instance serving the project, so
that instance has to be reachable — a local `platform/wab` on `:3003` for local
development.

## Testing an unreleased package change

Registry versions can only ever exercise what has shipped. To run this app
against working-tree changes to the package, pack the package and install the
tarball:

```bash
# in plasmicpkgs/commerce-providers/elastic-path
yarn start                        # tsdx watch — a full `yarn build` takes ~28 minutes
node build-server.mjs             # only needed for the /server entry (esbuild, seconds)
npm pack --pack-destination /tmp

# here — point the dependency at the tarball, then reinstall from scratch
#   "@elasticpath/plasmic-ep-commerce-elastic-path":
#     "file:/tmp/elasticpath-plasmic-ep-commerce-elastic-path-<version>.tgz"
rm -rf node_modules yarn.lock .next && yarn install
```

**Do not use `yarn add file:../../plasmicpkgs/commerce-providers/elastic-path`.**
Yarn's `file:` protocol copies the linked package's `node_modules` *and* its
devDependencies into this tree, which lands a second `@plasmicapp/host` (1.0.233)
and a second React alongside the ones this app resolves. `DataProvider` comes
from `@plasmicapp/host`, so components publish into one copy's React context
while the loader reads `$ctx` from the other — data silently disappears from
`$ctx` with no error. `npm pack` respects `files: ["dist"]` and reproduces
exactly what npm publishes, giving a single copy of each.

Revert the `package.json` and `yarn.lock` changes before committing — this app
is meant to reflect what a customer installs.

> Under `next dev`, Next's RSC debug instrumentation serializes server-component
> locals — including the EP session and its access token — into the page source.
> That does not happen in `next build` output. Don't run a dev server on a shared
> host or against production Elastic Path credentials.
