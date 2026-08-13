# Elastic Path Custom API queries for Plasmic Studio

Two read-only Studio server queries over a store's Commerce Extensions Custom APIs, so a
page can render entries a customer manages in Commerce Manager — store locators, FAQ
entries, size charts, editorial metadata — without a developer writing a component.

Deliberately longer than the other package READMEs in this repository. There is no Custom
API dropdown and no field metadata in the editor (see [Why there is no Custom API
list](#why-there-is-no-custom-api-list)), so this file is where a designer finds out what
their store actually has.

## Adding it to a project

In Studio, open the add drawer and pick **Query Custom API Entries** or **Get Custom API
Entry** under **Elastic Path CMS**. Choosing either installs the package into the project
and opens a draft query — there is nothing to add by hand.

An application acting as its own app host registers them instead:

```ts
import { registerAll } from "@elasticpath/plasmic-ep-custom-api-cms";

registerAll(PLASMIC);
```

## Connecting a store

Both queries take the same two credentials:

- **Region host** — the Elastic Path API host for the store's region, for example
  `https://euwest.api.elasticpath.com`. The dropdown lists the production regions; bind the
  parameter to a value directly for any other environment.
- **Client ID** — found in Commerce Manager under **System → Application Keys**.

**No client secret is ever required.** The queries authenticate with an implicit token
minted from the client ID alone, held in memory for the life of the page and never written
to browser storage. If a setup asks you for a client secret, it is not this package.

## The queries

### Query Custom API Entries

Returns the entries as a plain array, ready to bind to a repeater. Custom fields arrive
flat on each entry.

| Parameter | Notes |
|---|---|
| Custom API | The slug, not the display name. Commerce Manager shows it under Commerce Extensions. |
| Filter | An Elastic Path filter expression, for example `eq(status,published)` or `like(title,*sale*)`. Combine conditions with a colon: `eq(status,published):ge(rating,4)`. |
| Sort by | Creation time, update time or entry ID, each in either direction, or **Unsorted (fastest)**. |
| Limit | Entries to fetch, up to 100. |
| Offset | Entries to skip, for a load-more control. |

### Get Custom API Entry

Returns one entry, for a detail page. Bind **Entry** to the page's route parameter. The
value is either the entry's ID or, where the Custom API defines a url-slug field, that
field's value — Elastic Path addresses entries by that value instead of the ID once such a
field exists, and this query accepts either.

A missing entry fails the query rather than rendering an empty page, so a stale link is
visible rather than silent.

## When a query is refused

A refused read reports:

> Elastic Path refused to read Custom API "…". Most often the store has not exposed its
> entries to shoppers …

Reading entries with an implicit token depends on the store granting the shopper role
access to that Custom API, through a Custom API role policy with `list` and `read`. The
shape below comes from the Commerce Extensions and Permissions API specifications and has
not been executed as written here — treat it as the structure to build from, not a
copy-paste recipe. `role.data.id` comes from listing the store's standard shopper roles.

```
POST /v2/permissions/custom-api-role-policies
{
  "data": {
    "type": "custom_api_role_policy",
    "create": false, "list": true, "read": true, "update": false, "delete": false,
    "relationships": {
      "custom_api": { "data": { "id": "<custom api id>", "type": "custom_api" } },
      "role": { "data": { "id": "<shopper role id>", "type": "standard_shopper_role" } }
    }
  }
}
```

One caveat, stated because it cuts the other way: on the store this package was verified
against, a Custom API's entries read successfully with an implicit token and no policy had
knowingly been configured for it. So some Custom APIs may already be readable. Check for a
policy first when a read is refused, but do not assume every Custom API needs one.

## Why there is no Custom API list

Listing a store's Custom APIs, or reading their field definitions, requires Elastic Path's
settings endpoints. Those refuse an implicit token at the grant-type level, and no store
configuration changes that — a Custom API role policy governs entries, not definitions.

The only credential that can read them is a `client_credentials` pair, which carries full
read and write access across the entire store and cannot be narrowed by role. Studio
evaluates query parameters in the designer's browser and carries them in the project
bundle, so such a secret would be exposed to every designer and, in a rendered
application, reachable by shoppers. Naming the Custom API by hand is the price of this
package holding no secret at all. `docs/adr/0001-implicit-credentials-no-schema-discovery.md`
records the decision.

Field *names* are recovered without any secret: the filter parameter's hint samples one
entry and lists what it finds.

## Limits worth knowing before you design

These are Elastic Path's, not this package's:

- **Sorting is limited to entry ID, creation time and update time.** Custom fields are not
  sortable, so an alphabetical list of locations or a hand-ordered FAQ has to be ordered in
  the page rather than the query.
- **An entry cannot exceed 64 KB**, which rules out long-form article bodies.
- **Limit caps at 100 and offset at 10,000**, so offset paging cannot walk past 10,000
  entries.
- **No totals.** The queries return entries, not a count, so build load-more rather than
  numbered pages.
- **Reads only.** Creating, updating and deleting entries is out of scope.

## Traps confirmed against a live store

- **`created_at` and `updated_at` are not top-level fields.** They live under
  `meta.timestamps` on each entry. Bind accordingly.
- **`is_null` silently misses entries.** Elastic Path does not match `is_null` against an
  entry that was last updated before the field existed. A field that is genuinely null on
  such an entry will not appear in the results. Updating the entry fixes it for that entry.
- **The default limit is a store setting.** With no limit set, the store's page-length
  setting decides; it was 25 on the store used for verification, not the API maximum.

## What the filter hint can and cannot tell you

The hint under the filter names the fields found on one sampled entry, with a type inferred
from the JSON. Three things follow:

- Integer and float both read as `number`.
- A field that is null on the sampled entry shows its name and `unknown`.
- A Custom API with no entries yields no field names, and the hint shows the filter syntax
  instead.

The sample is taken once per store and Custom API, so editing a filter does not re-sample.
