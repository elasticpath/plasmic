/**
 * Test fixture: realistic Site object for integration tests.
 *
 * Creates a fresh copy each call so mutations in one test don't leak to others.
 * Uses duck-typed plain objects with _type fields that match the WAB mock type
 * guards (isKnownTplTag checks _type === "TplTag", etc.).
 *
 * Structure:
 *   Site
 *   ├── Homepage (page, path: "/")
 *   │   └── Root (div)
 *   │       ├── Hero (section)
 *   │       │   ├── Hero Title (h1) — text: "Welcome Home"
 *   │       │   └── Hero Subtitle (p) — text: "Build something amazing"
 *   │       └── Content (section)
 *   │           ├── Card 1 (div) — text: "First card content"
 *   │           └── Card 2 (div) — text: "Second card content"
 *   └── Header (component, no path)
 *       └── HeaderRoot (header)
 *           ├── Logo (span) — text: "MySite"
 *           └── Navigation (nav)
 *
 * Node UUIDs, names, and paths are documented here so tests can reference them.
 * Node resolver paths use dot-separated ancestor names:
 *   - "Root" / "Root.Hero" / "Root.Hero.Hero Title"
 */

export function createTestSite(): any {
  return {
    _type: "Site",
    components: [createHomepage(), createHeaderComponent()],
    styleTokens: [
      {
        uuid: "token-primary",
        name: "Primary",
        type: "Color",
        value: "#3b82f6",
      },
      {
        uuid: "token-spacing-sm",
        name: "SM",
        type: "Spacing",
        value: "8px",
      },
    ],
    globalVariantGroups: [],
  };
}

function createHomepage(): any {
  const heroTitle: any = {
    _type: "TplTag",
    tag: "h1",
    uuid: "title-uuid",
    name: "Hero Title",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            fontSize: "48px",
            fontWeight: "bold",
            color: "#1a1a1a",
          },
        },
        text: { _type: "RawText", text: "Welcome Home", markers: [] },
        attrs: {},
      },
    ],
  };

  const heroSubtitle: any = {
    _type: "TplTag",
    tag: "p",
    uuid: "subtitle-uuid",
    name: "Hero Subtitle",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            fontSize: "18px",
            color: "#666666",
            lineHeight: "1.6",
          },
        },
        text: {
          _type: "RawText",
          text: "Build something amazing",
          markers: [],
        },
        attrs: {},
      },
    ],
  };

  const hero: any = {
    _type: "TplTag",
    tag: "section",
    uuid: "hero-uuid",
    name: "Hero",
    children: [heroTitle, heroSubtitle],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            display: "flex",
            flexDirection: "column",
            padding: "64px 32px",
            background: "linear-gradient(#f8f9fa, #f8f9fa)",
          },
        },
        attrs: {},
      },
    ],
  };

  const card1: any = {
    _type: "TplTag",
    tag: "div",
    uuid: "card1-uuid",
    name: "Card 1",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            padding: "16px",
            background: "linear-gradient(#ffffff, #ffffff)",
            borderRadius: "8px",
          },
        },
        text: { _type: "RawText", text: "First card content", markers: [] },
        attrs: {},
      },
    ],
  };

  const card2: any = {
    _type: "TplTag",
    tag: "div",
    uuid: "card2-uuid",
    name: "Card 2",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            padding: "16px",
            background: "linear-gradient(#ffffff, #ffffff)",
            borderRadius: "8px",
          },
        },
        text: {
          _type: "RawText",
          text: "Second card content",
          markers: [],
        },
        attrs: {},
      },
    ],
  };

  const content: any = {
    _type: "TplTag",
    tag: "section",
    uuid: "content-uuid",
    name: "Content",
    children: [card1, card2],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            display: "flex",
            flexDirection: "row",
            gap: "16px",
            padding: "32px",
          },
        },
        attrs: {},
      },
    ],
  };

  const root: any = {
    _type: "TplTag",
    tag: "div",
    uuid: "page-root-uuid",
    name: "Root",
    children: [hero, content],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: { display: "flex", flexDirection: "column" },
        },
        attrs: {},
      },
    ],
  };

  // Set parent pointers (used by findParent in edit-tools)
  hero.parent = root;
  content.parent = root;
  heroTitle.parent = hero;
  heroSubtitle.parent = hero;
  card1.parent = content;
  card2.parent = content;

  return {
    uuid: "page-home-uuid",
    name: "Homepage",
    pageMeta: { path: "/" },
    tplTree: root,
  };
}

function createHeaderComponent(): any {
  const logo: any = {
    _type: "TplTag",
    tag: "span",
    uuid: "logo-uuid",
    name: "Logo",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: { values: { fontSize: "24px", fontWeight: "bold" } },
        text: { _type: "RawText", text: "MySite", markers: [] },
        attrs: {},
      },
    ],
  };

  const nav: any = {
    _type: "TplTag",
    tag: "nav",
    uuid: "nav-uuid",
    name: "Navigation",
    children: [],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: { values: { display: "flex", gap: "16px" } },
        attrs: {},
      },
    ],
  };

  const root: any = {
    _type: "TplTag",
    tag: "header",
    uuid: "header-root-uuid",
    name: "HeaderRoot",
    children: [logo, nav],
    parent: null,
    vsettings: [
      {
        variants: [],
        rs: {
          values: {
            display: "flex",
            justifyContent: "space-between",
            padding: "16px 32px",
          },
        },
        attrs: {},
      },
    ],
  };

  logo.parent = root;
  nav.parent = root;

  return {
    uuid: "comp-header-uuid",
    name: "Header",
    tplTree: root,
  };
}
