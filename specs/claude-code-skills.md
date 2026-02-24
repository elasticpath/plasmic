# Claude Code Skills for Plasmic Studio

## Jobs to Be Done
- As a developer using Claude Code, I want to say "create a product listing page in Plasmic" and have Claude orchestrate the MCP tools to build it, so that I can create pages without switching to the browser.
- As a developer exploring a Plasmic project, I want to ask Claude "what pages exist?" or "show me the homepage structure" and get instant answers from the live model, so that I understand the project without opening Studio.
- As a team lead, I want a repeatable workflow that anyone on the team can invoke from the terminal, so that page creation follows consistent patterns.

## Architecture

### How Skills Relate to the MCP Server

The MCP server (`@elasticpath/plasmic-mcp`) provides low-level tools: `set-project`, `list-projects`, `list-components`, `get-component-tree`, `get-project-meta`, `create-page`. These tools are protocol-level -- they do one thing each and return structured data.

Skills are the prompt layer on top. They live in `.claude/commands/` as Markdown files and provide:
- **Context** -- what the tools do, what formats they accept, what patterns work
- **Orchestration** -- which tools to call in what order for a given workflow
- **Domain knowledge** -- PlasmicElement tree patterns, naming conventions, page structure best practices
- **Error recovery** -- what to do when a tool returns an error

```
Developer: "create a hero page at /about"
    |
    v
Claude Code skill (.claude/commands/plasmic-create-page.md)
    |  - Understands PlasmicElement format
    |  - Knows to call set-project first if needed
    |  - Builds element tree from natural language
    |  - Handles errors and retries
    v
MCP tool calls (set-project, list-components, create-page)
    |
    v
Plasmic REST API
```

### File Layout

```
.claude/
├── mcp.json                              # MCP server configuration
└── commands/
    ├── plasmic.md                        # Top-level routing skill
    ├── plasmic-create-page.md            # Page creation workflow
    ├── plasmic-inspect.md                # Project inspection workflow
    └── plasmic-patterns.md               # PlasmicElement reference patterns
```

### MCP Configuration

`.claude/mcp.json` for local development (using tsx to run from source):

```json
{
  "mcpServers": {
    "plasmic": {
      "command": "tsx",
      "args": ["packages/plasmic-mcp/src/index.ts"],
      "env": {
        "PLASMIC_AUTH_HOST": "${PLASMIC_AUTH_HOST}",
        "PLASMIC_AUTH_USER": "${PLASMIC_AUTH_USER}",
        "PLASMIC_AUTH_TOKEN": "${PLASMIC_AUTH_TOKEN}"
      }
    }
  }
}
```

For production (after npm publish):

```json
{
  "mcpServers": {
    "plasmic": {
      "command": "npx",
      "args": ["@elasticpath/plasmic-mcp"],
      "env": {
        "PLASMIC_AUTH_HOST": "${PLASMIC_AUTH_HOST}",
        "PLASMIC_AUTH_USER": "${PLASMIC_AUTH_USER}",
        "PLASMIC_AUTH_TOKEN": "${PLASMIC_AUTH_TOKEN}"
      }
    }
  }
}
```

## Acceptance Criteria

### Must Have
- [ ] Skill `/plasmic` routes natural language to the correct sub-workflow
- [ ] Skill `/plasmic-create-page` creates a page with a valid PlasmicElement tree from a natural language description
- [ ] Skill `/plasmic-inspect` displays project structure, pages, and component trees
- [ ] Skills call `set-project` automatically when no project is active
- [ ] Skills include PlasmicElement type reference so Claude can construct valid trees
- [ ] Skills surface MCP tool errors with actionable guidance
- [ ] `.claude/mcp.json` exists and works for local development

### Nice to Have
- [ ] Pattern library of common PlasmicElement trees (hero, grid, card, form) embedded in skill prompts
- [ ] Skill `/plasmic-create-page` can reference existing components from the project when building pages
- [ ] Skills suggest design token values from `get-tokens` (when available)

## Skills

### `/plasmic` -- Top-Level Router

The entry point for all Plasmic interactions. Interprets the developer's intent and routes to the appropriate sub-workflow.

**Trigger:** Developer invokes `/plasmic` with a natural language request.

**Behavior:**

1. If no project is active (no prior `set-project` call in this session), ask the developer which project to work on. Call `list-projects` to show available options, then `set-project` with their choice.

2. Route based on intent:
   - "create a page", "add a page", "make a new page" -> delegate to `/plasmic-create-page` logic
   - "what pages exist", "show me the project", "list components" -> delegate to `/plasmic-inspect` logic
   - "show me the homepage", "what does X look like" -> call `get-component-tree` directly
   - Ambiguous request -> ask a clarifying question

3. After completing the action, summarize what was done.

**Prompt structure:**
```markdown
You have access to Plasmic MCP tools for interacting with Plasmic Studio.

## Available Tools
- `set-project(projectId)` -- Load a project into memory. Must be called before model-reading tools.
- `list-projects()` -- List all accessible projects. No active project required.
- `get-project-meta()` -- Get project metadata (name, counts). Requires active project.
- `list-components()` -- List all pages and components. Requires active project.
- `get-component-tree(componentUuid)` -- Get a component's element tree as PlasmicElement JSON. Requires active project.
- `create-page(name, path, body)` -- Create a new page. Requires active project.

## Instructions
1. If no project is set, call list-projects and ask the user which one to work on, then call set-project.
2. Interpret the user's request and call the appropriate tools.
3. Summarize results clearly.

## User's Request
{{input}}
```

### `/plasmic-create-page` -- Page Creation Workflow

A focused workflow for creating new pages in Plasmic from natural language descriptions.

**Trigger:** Developer invokes `/plasmic-create-page` with a page description.

**Behavior:**

1. Ensure a project is active. If not, prompt for project selection.
2. Call `list-components` to understand what already exists in the project (existing pages, reusable components).
3. Parse the developer's description to determine:
   - Page name (e.g., "Product Listing" -> `ProductListing`)
   - Page path (e.g., `/products`)
   - Page structure (hero section, grid, sidebar, etc.)
4. Build a `PlasmicElement` tree using the type reference below.
5. Call `create-page` with the constructed tree.
6. Report the result: new page UUID, path, and any warnings.

**Prompt structure:**
```markdown
You are creating a new page in a Plasmic project.

## Available Tools
- `set-project(projectId)` -- Load a project. Call first if no project is active.
- `list-projects()` -- List accessible projects.
- `list-components()` -- List existing pages and components.
- `create-page(name, path, body)` -- Create a page with a PlasmicElement tree.

## PlasmicElement Type Reference

A PlasmicElement is a recursive JSON structure. The `create-page` tool accepts this as the `body` parameter.

### Element Types

**Container (box/vbox/hbox/page-section):**
```json
{
  "type": "vbox",
  "styles": { "padding": "40px 20px", "gap": "24px" },
  "children": [ ...child elements... ]
}
```
- `type: "vbox"` -- vertical stack (flex column)
- `type: "hbox"` -- horizontal stack (flex row)
- `type: "box"` -- basic flex container
- `type: "page-section"` -- full-width page section
- `tag` defaults to `"div"`, can be `"section"`, `"nav"`, `"header"`, `"footer"`, `"main"`, `"article"`, `"aside"`, `"ul"`, `"ol"`, `"li"`, `"form"`, `"a"`, `"button"`, etc.
- `children` can be a single element or an array

**Text:**
```json
{
  "type": "text",
  "value": "Hello World",
  "tag": "h1",
  "styles": { "fontSize": "32px", "fontWeight": "700" }
}
```
- `tag` defaults to `"div"`, can be `"h1"`-`"h6"`, `"p"`, `"span"`, `"a"` (with href in attrs), etc.
- `value` is the text content (plain string)
- A bare string `"Hello"` is also a valid TextElement

**Image:**
```json
{
  "type": "img",
  "src": "https://example.com/image.jpg",
  "styles": { "width": "100%", "objectFit": "cover" },
  "attrs": { "alt": "Description" }
}
```

**Button:**
```json
{
  "type": "button",
  "value": "Click Me",
  "styles": { "padding": "12px 24px", "backgroundColor": "#0070f3", "color": "#ffffff", "borderRadius": "8px" }
}
```

**Input:**
```json
{
  "type": "input",
  "styles": { "padding": "8px 12px", "border": "1px solid #ccc", "borderRadius": "4px" },
  "attrs": { "placeholder": "Enter text..." }
}
```

### Common Page Patterns

**Page with hero and content:**
```json
{
  "type": "vbox",
  "styles": { "width": "100%" },
  "children": [
    {
      "type": "page-section",
      "styles": { "padding": "80px 20px", "backgroundColor": "#f8f9fa", "alignItems": "center" },
      "children": [
        {
          "type": "text",
          "tag": "h1",
          "value": "Page Title",
          "styles": { "fontSize": "48px", "fontWeight": "700", "textAlign": "center" }
        },
        {
          "type": "text",
          "tag": "p",
          "value": "Subtitle or description text goes here.",
          "styles": { "fontSize": "18px", "color": "#666", "textAlign": "center", "maxWidth": "600px" }
        }
      ]
    },
    {
      "type": "page-section",
      "styles": { "padding": "60px 20px" },
      "children": [ ]
    }
  ]
}
```

## Instructions
1. If no project is active, call list-projects and ask the user which project, then set-project.
2. Call list-components to see what pages already exist (avoid path conflicts).
3. Based on the user's description, construct a PlasmicElement tree.
4. Choose a reasonable page name (PascalCase) and path (kebab-case with leading slash).
5. Call create-page with the constructed tree.
6. Report the created page UUID and path. Note any warnings from the API.

## User's Request
{{input}}
```

### `/plasmic-inspect` -- Project Inspection Workflow

A read-only workflow for understanding the current state of a Plasmic project.

**Trigger:** Developer invokes `/plasmic-inspect` optionally with a specific question.

**Behavior:**

1. Ensure a project is active. If not, prompt for project selection.
2. Call `get-project-meta` for overview statistics.
3. Call `list-components` to get the full component/page listing.
4. If the developer asked about a specific component, call `get-component-tree` for that component.
5. Present findings in a structured, readable format.

**Prompt structure:**
```markdown
You are inspecting a Plasmic project to help the developer understand its structure.

## Available Tools
- `set-project(projectId)` -- Load a project. Call first if no project is active.
- `list-projects()` -- List accessible projects.
- `get-project-meta()` -- Get project metadata (name, component count, page count).
- `list-components()` -- List all pages and components with UUIDs and paths.
- `get-component-tree(componentUuid)` -- Get a component's PlasmicElement tree.

## Instructions
1. If no project is active, call list-projects and ask the user which project, then set-project.
2. Call get-project-meta for an overview.
3. Call list-components for the full listing.
4. Present the results clearly:
   - Project name and summary stats
   - Pages listed with their paths
   - Components listed with their names
5. If the user asked about a specific component or page, call get-component-tree and describe its structure.
6. Use the PlasmicElement JSON to describe the tree in human-readable terms (e.g., "a vertical stack containing a heading, a paragraph, and a 3-column grid of cards").

## User's Request
{{input}}
```

## Happy Path

### Scenario 1: Create a Page

```
Developer: /plasmic-create-page Create an about page with a hero section, team grid, and contact form

Claude: I'll create that page. Let me first check the project.
  -> calls set-project("abc123")  [if not already set]
  -> calls list-components()      [checks existing pages, no /about conflict]
  -> builds PlasmicElement tree:
     vbox
       page-section (hero): h1 "About Us", p subtitle
       page-section (team): h2 "Our Team", hbox grid of 3 vbox cards
       page-section (contact): h2 "Get in Touch", vbox with inputs and button
  -> calls create-page("About", "/about", <element tree>)

Claude: Created page "About" at /about (UUID: xyz789). The page has three sections:
  1. Hero section with title and subtitle
  2. Team grid with 3 card placeholders
  3. Contact form with name, email, message fields and a submit button

  You can now open it in Plasmic Studio to refine styles and add real content.
```

### Scenario 2: Inspect a Project

```
Developer: /plasmic-inspect

Claude: Let me look at the project.
  -> calls get-project-meta()
  -> calls list-components()

Claude: Project "My Store" has 12 components:

  Pages (4):
    - Homepage .............. /            (uuid: abc-111)
    - Product Listing ....... /products    (uuid: abc-222)
    - Product Detail ........ /products/:slug (uuid: abc-333)
    - Cart .................. /cart        (uuid: abc-444)

  Components (8):
    - Header                 (uuid: abc-555)
    - Footer                 (uuid: abc-666)
    - ProductCard            (uuid: abc-777)
    - HeroSection            (uuid: abc-888)
    - ...

  Would you like me to show the structure of any specific page or component?
```

### Scenario 3: Top-Level Routing

```
Developer: /plasmic show me what the homepage looks like

Claude: Let me fetch the homepage structure.
  -> calls get-component-tree("abc-111")

Claude: The Homepage is a vertical stack containing:
  1. Header component (referenced, not inlined)
  2. Hero section
     - Heading: "Welcome to My Store"
     - Subheading: "Shop the latest products"
     - CTA button: "Browse Products" (links to /products)
  3. Featured Products section
     - 4x ProductCard components in a horizontal grid
  4. Footer component (referenced, not inlined)
```

## Edge Cases

| Scenario | Expected behaviour |
|----------|-------------------|
| No `.claude/mcp.json` configured | Skill prompt includes setup instructions: "Run `claude mcp add plasmic -- npx @elasticpath/plasmic-mcp` or create `.claude/mcp.json`" |
| MCP server not running / tool call fails | Surface the error message from the MCP response. Suggest checking that the server is configured and env vars are set. |
| No project selected and developer doesn't specify one | Call `list-projects`, present options, ask developer to choose |
| `create-page` returns a path conflict warning | Report the adjusted path to the developer: "Note: /products was already taken, so the page was created at /products-1" |
| `get-component-tree` returns undefined | Report: "Could not read the component tree. It may use element types not yet supported by the reader." |
| Developer asks to create a page that already exists | Check `list-components` first. Warn: "A page at /about already exists. Would you like to use a different path?" |
| PlasmicElement tree is rejected by API | Surface the API error. Suggest simplifying the tree or checking element type validity. |
| Very large component tree in response | Summarize the tree structure rather than dumping raw JSON. Show top 2-3 levels with "...N more children" for deeper nesting. |
| Developer asks for something outside Plasmic scope | Respond that the Plasmic tools handle page/component operations, and suggest the appropriate tool for their request. |

## Out of Scope

- Skills for editing existing pages (requires Milestone 2: incremental writes)
- Skills for managing design tokens or styles
- Skills for code component wiring
- Skills for publishing or deploying
- Multi-project workflows (working across projects simultaneously)
- Automated testing of created pages
- Version control or branching workflows within Plasmic

## Technical Notes

### Skill File Format

Claude Code skills are Markdown files in `.claude/commands/`. The filename (without `.md`) becomes the command name. The file content is injected as a system prompt when the command is invoked.

The `{{input}}` placeholder is replaced with whatever the developer types after the command name.

Example: `.claude/commands/plasmic-create-page.md` is invoked as `/plasmic-create-page Create an about page`.

### PlasmicElement Validation

The MCP server's `create-page` tool passes the PlasmicElement tree directly to the Plasmic API. Validation happens server-side. Common validation errors:
- Unknown `type` value (must be one of: `img`, `text`, `box`, `vbox`, `hbox`, `page-section`, `button`, `input`, `password`, `textarea`, `component`, `default-component`)
- Missing required fields (`src` for images, `value` for text)
- Invalid `tag` values for the given element type
- Nested structures that exceed depth limits

Skills should construct conservative trees using well-known patterns rather than attempting novel structures.

### Session Persistence

The MCP server maintains session state (active project, live model) for the duration of the MCP connection. In Claude Code, this means the session persists for the entire conversation. If the developer starts a new conversation, `set-project` must be called again.

Skills should check for an active project at the start of every workflow rather than assuming one exists.

### PlasmicElement CSS Properties

Styles use the React `CSSProperties` format (camelCase):
- `fontSize` not `font-size`
- `backgroundColor` not `background-color`
- `borderRadius` not `border-radius`
- Values are strings: `"16px"`, `"#ff0000"`, `"1px solid #ccc"`
- Numeric values for unitless properties: `{ lineHeight: 1.5 }` (as number, not string)

The special `layout` property (`"vbox"`, `"hbox"`, `"box"`, `"page-section"`) is set via the element `type`, not via styles.
