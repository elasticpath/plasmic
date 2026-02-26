# Data Queries

## Jobs to Be Done
- As a Claude Code user building data-driven pages, I want to create data queries on components so that pages can fetch and display dynamic data
- As a Claude Code user, I want to reference query results in dynamic text and conditions so that UI reflects real data

## Background

Studio components have `ComponentDataQuery` (client-side fetches) and `ComponentServerQuery` (server-side operations). Queries are referenced in expressions via `$queries.queryName`. TplMgr provides: `removeComponentQuery()`, `removeComponentServerQuery()`, `clearReferencesToRemovedQueries()`.

Query data sources are configured externally (Plasmic CMS, REST, GraphQL, etc.). The MCP can create query definitions that reference these configured sources.

## Implementation

Data query CRUD integrates into the `component` domain.

### `component({ action: "add-query" })`
- **Parameters**: `componentUuid`, `name`, `queryType` (dataQuery | serverQuery), `op?` (DataSourceOpExpr config)
- Creates a ComponentDataQuery or ComponentServerQuery
- Returns: `{ queryUuid, name, queryType }`

### `component({ action: "list-queries" })`
- **Parameters**: `componentUuid`
- Returns: Array of `{ queryUuid, name, queryType, op? }`

### `component({ action: "remove-query" })`
- **Parameters**: `componentUuid`, `queryRef` (name or UUID)
- Removes query + cleans up expression references

### `component({ action: "update-query" })`
- **Parameters**: `componentUuid`, `queryRef`, `name?`, `op?`
- Updates query name or operation

## Acceptance Criteria
- [x] Can create a data query on a component
- [x] Can list all queries on a component
- [x] Can remove a query with expression cleanup
- [x] Can reference query results in dynamic text: `$queries.myQuery.data`
- [x] Can reference query results in data-cond: `$queries.myQuery.data.length > 0`
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: create query → reference in dynamic text → verify
- [x] Unit tests for all CRUD operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Duplicate query name | Auto-deduplicate |
| Remove query used in expressions | Clean up expressions, log in response |
| Query referencing unconfigured data source | Accept definition (runtime error, not build-time) |
| Component has no data source integrations | Query created but will produce no data at runtime |

## Out of Scope
- Data source configuration (REST endpoints, CMS setup, etc.)
- Query caching and invalidation strategies
- Real-time/subscription queries
