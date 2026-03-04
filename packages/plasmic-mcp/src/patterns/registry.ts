/**
 * Pattern Registry — static + user-defined PlasmicElement patterns.
 *
 * Patterns let the LLM instantiate common page sections (heroes, cards, navbars,
 * etc.) in a single compound tool call instead of composing many low-level
 * primitives. The registry ships 8 starter patterns; users can add their own
 * via `*.pattern.json` files in `PLASMIC_MCP_PATTERNS_DIR` (default:
 * `.plasmic/patterns/`). User patterns take precedence on name collision.
 */

import * as fs from "fs";
import * as path from "path";
import type { PlasmicElement } from "../types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PatternDefinition {
  /** Unique slug, e.g. "hero-centered" */
  name: string;
  /** One-sentence summary shown in listPatterns */
  description: string;
  /** Searchable tags, e.g. ["layout","marketing","hero"] */
  tags: string[];
  /** Plain-text description of what the rendered output looks like */
  previewDescription: string;
  /** Customisation keys this pattern supports (text substitutions) */
  customisationKeys: string[];
  /** The PlasmicElement tree to instantiate */
  tree: PlasmicElement;
}

// ---------------------------------------------------------------------------
// Built-in starter patterns
// ---------------------------------------------------------------------------

const BUILTIN_PATTERNS: PatternDefinition[] = [
  {
    name: "hero-centered",
    description: "Centred heading, subheading, and CTA button",
    tags: ["layout", "marketing", "hero"],
    previewDescription:
      "A full-width section with vertically centred heading (h1), subtitle paragraph, and a primary CTA button, all on a light grey background.",
    customisationKeys: ["headingText", "subtitleText", "ctaLabel"],
    tree: {
      type: "page-section",
      tag: "section",
      styles: {
        padding: "80px 20px",
        backgroundColor: "#f8f9fa",
        alignItems: "center",
        gap: "24px",
      },
      children: [
        {
          type: "text",
          tag: "h1",
          value: "Page Title",
          styles: {
            fontSize: "48px",
            fontWeight: "700",
            textAlign: "center",
          },
        },
        {
          type: "text",
          tag: "p",
          value: "Subtitle or description goes here.",
          styles: {
            fontSize: "18px",
            color: "#666666",
            textAlign: "center",
            maxWidth: "600px",
          },
        },
        {
          type: "button",
          value: "Get Started",
          styles: {
            padding: "12px 32px",
            backgroundColor: "#0070f3",
            color: "#ffffff",
            borderRadius: "8px",
            fontSize: "16px",
            fontWeight: "600",
          },
        },
      ],
    },
  },

  {
    name: "hero-split",
    description: "Heading and copy on the left, image placeholder on the right",
    tags: ["layout", "marketing", "hero"],
    previewDescription:
      "A two-column hero: left column has heading, paragraph, and CTA; right column has a placeholder image. Stacks vertically on narrow viewports via flex-wrap.",
    customisationKeys: ["headingText", "bodyText", "ctaLabel", "imageSrc"],
    tree: {
      type: "page-section",
      tag: "section",
      styles: {
        padding: "80px 20px",
        alignItems: "center",
        gap: "40px",
      },
      children: [
        {
          type: "hbox",
          styles: {
            gap: "40px",
            maxWidth: "1200px",
            width: "100%",
            flexWrap: "wrap",
            alignItems: "center",
          },
          children: [
            {
              type: "vbox",
              styles: {
                flex: "1 1 400px",
                gap: "20px",
              },
              children: [
                {
                  type: "text",
                  tag: "h1",
                  value: "Build Something Great",
                  styles: {
                    fontSize: "48px",
                    fontWeight: "700",
                  },
                },
                {
                  type: "text",
                  tag: "p",
                  value:
                    "A compelling description of your product or service that speaks to your audience.",
                  styles: {
                    fontSize: "18px",
                    color: "#666666",
                    lineHeight: "1.6",
                  },
                },
                {
                  type: "button",
                  value: "Learn More",
                  styles: {
                    padding: "12px 32px",
                    backgroundColor: "#0070f3",
                    color: "#ffffff",
                    borderRadius: "8px",
                    fontSize: "16px",
                    fontWeight: "600",
                    alignSelf: "flex-start",
                  },
                },
              ],
            },
            {
              type: "img",
              src: "https://placehold.co/600x400",
              styles: {
                flex: "1 1 400px",
                width: "100%",
                borderRadius: "12px",
                objectFit: "cover",
              },
              attrs: { alt: "Hero image" },
            },
          ],
        },
      ],
    },
  },

  {
    name: "card-basic",
    description: "Image, title, body text, and action link",
    tags: ["layout", "content", "card"],
    previewDescription:
      "A vertical card with a top image, title, body paragraph, and a text link at the bottom, with a subtle border and rounded corners.",
    customisationKeys: [
      "imageSrc",
      "titleText",
      "bodyText",
      "actionLabel",
    ],
    tree: {
      type: "vbox",
      styles: {
        borderRadius: "12px",
        overflow: "hidden",
        borderWidth: "1px",
        borderStyle: "solid",
        borderColor: "#e5e7eb",
        backgroundColor: "#ffffff",
      },
      children: [
        {
          type: "img",
          src: "https://placehold.co/400x240",
          styles: {
            width: "100%",
            height: "240px",
            objectFit: "cover",
          },
          attrs: { alt: "Card image" },
        },
        {
          type: "vbox",
          styles: { padding: "24px", gap: "12px" },
          children: [
            {
              type: "text",
              tag: "h3",
              value: "Card Title",
              styles: { fontSize: "20px", fontWeight: "600" },
            },
            {
              type: "text",
              tag: "p",
              value: "Card description goes here.",
              styles: { fontSize: "14px", color: "#666666" },
            },
            {
              type: "text",
              tag: "a",
              value: "Read more →",
              styles: {
                fontSize: "14px",
                color: "#0070f3",
                fontWeight: "500",
              },
              attrs: { href: "#" },
            },
          ],
        },
      ],
    },
  },

  {
    name: "card-grid",
    description: "3-column responsive grid of cards",
    tags: ["layout", "content", "card", "grid"],
    previewDescription:
      "A section heading followed by three card-basic instances in a responsive horizontal row (wraps on narrow viewports). Each card has an image, title, body, and link.",
    customisationKeys: ["sectionTitle"],
    tree: {
      type: "page-section",
      tag: "section",
      styles: {
        padding: "60px 20px",
        alignItems: "center",
        gap: "40px",
      },
      children: [
        {
          type: "text",
          tag: "h2",
          value: "Featured Content",
          styles: {
            fontSize: "36px",
            fontWeight: "700",
            textAlign: "center",
          },
        },
        {
          type: "hbox",
          styles: {
            gap: "24px",
            maxWidth: "1200px",
            width: "100%",
            flexWrap: "wrap",
            justifyContent: "center",
          },
          children: [
            makeCardInstance("Card One", "Description of the first card."),
            makeCardInstance("Card Two", "Description of the second card."),
            makeCardInstance("Card Three", "Description of the third card."),
          ],
        },
      ],
    },
  },

  {
    name: "navbar-simple",
    description: "Logo on the left, nav links in the centre, CTA on the right",
    tags: ["layout", "navigation", "navbar"],
    previewDescription:
      "A horizontal navigation bar with a brand name on the left, three navigation links in the centre, and a sign-up button on the right, separated by a bottom border.",
    customisationKeys: ["brandName", "ctaLabel"],
    tree: {
      type: "hbox",
      tag: "nav",
      styles: {
        padding: "16px 24px",
        justifyContent: "space-between",
        alignItems: "center",
        borderBottomWidth: "1px",
        borderBottomStyle: "solid",
        borderBottomColor: "#e5e7eb",
      },
      children: [
        {
          type: "text",
          tag: "span",
          value: "Brand",
          styles: { fontSize: "20px", fontWeight: "700" },
        },
        {
          type: "hbox",
          styles: { gap: "24px", alignItems: "center" },
          children: [
            {
              type: "text",
              tag: "a",
              value: "Home",
              styles: { fontSize: "16px", color: "#333333" },
              attrs: { href: "/" },
            },
            {
              type: "text",
              tag: "a",
              value: "About",
              styles: { fontSize: "16px", color: "#333333" },
              attrs: { href: "/about" },
            },
            {
              type: "text",
              tag: "a",
              value: "Contact",
              styles: { fontSize: "16px", color: "#333333" },
              attrs: { href: "/contact" },
            },
          ],
        },
        {
          type: "button",
          value: "Sign Up",
          styles: {
            padding: "8px 20px",
            backgroundColor: "#0070f3",
            color: "#ffffff",
            borderRadius: "6px",
            fontSize: "14px",
            fontWeight: "600",
          },
        },
      ],
    },
  },

  {
    name: "form-contact",
    description: "Name, email, and message fields with a submit button",
    tags: ["layout", "form", "contact"],
    previewDescription:
      "A contact form section with a heading, name input, email input, textarea for message, and a submit button, all centred within a max-width container.",
    customisationKeys: ["headingText", "submitLabel"],
    tree: {
      type: "page-section",
      tag: "section",
      styles: {
        padding: "60px 20px",
        alignItems: "center",
        gap: "32px",
      },
      children: [
        {
          type: "text",
          tag: "h2",
          value: "Contact Us",
          styles: {
            fontSize: "36px",
            fontWeight: "700",
            textAlign: "center",
          },
        },
        {
          type: "vbox",
          tag: "form",
          styles: {
            gap: "16px",
            maxWidth: "500px",
            width: "100%",
          },
          children: [
            {
              type: "input",
              styles: {
                padding: "12px 16px",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "#d1d5db",
                borderRadius: "8px",
                fontSize: "16px",
              },
              attrs: { placeholder: "Your Name" },
            },
            {
              type: "input",
              styles: {
                padding: "12px 16px",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "#d1d5db",
                borderRadius: "8px",
                fontSize: "16px",
              },
              attrs: { placeholder: "your@email.com", type: "email" },
            },
            {
              type: "textarea" as "input",
              styles: {
                padding: "12px 16px",
                borderWidth: "1px",
                borderStyle: "solid",
                borderColor: "#d1d5db",
                borderRadius: "8px",
                fontSize: "16px",
                minHeight: "120px",
              },
              attrs: { placeholder: "Your message..." },
            },
            {
              type: "button",
              value: "Send Message",
              styles: {
                padding: "12px 32px",
                backgroundColor: "#0070f3",
                color: "#ffffff",
                borderRadius: "8px",
                fontSize: "16px",
                fontWeight: "600",
              },
            },
          ],
        },
      ],
    },
  },

  {
    name: "feature-row",
    description: "Three features in a horizontal row with icons, headings, and descriptions",
    tags: ["layout", "marketing", "features"],
    previewDescription:
      "A section with a heading and three feature columns, each containing an emoji icon, a feature title, and a description. Responsive via flex-wrap.",
    customisationKeys: ["sectionTitle"],
    tree: {
      type: "page-section",
      tag: "section",
      styles: {
        padding: "60px 20px",
        alignItems: "center",
        gap: "40px",
      },
      children: [
        {
          type: "text",
          tag: "h2",
          value: "Features",
          styles: {
            fontSize: "36px",
            fontWeight: "700",
            textAlign: "center",
          },
        },
        {
          type: "hbox",
          styles: {
            gap: "24px",
            maxWidth: "1200px",
            width: "100%",
            flexWrap: "wrap",
            justifyContent: "center",
          },
          children: [
            makeFeatureColumn("⚡", "Feature One", "Description of the first feature and its benefits."),
            makeFeatureColumn("🎯", "Feature Two", "Description of the second feature and its benefits."),
            makeFeatureColumn("🚀", "Feature Three", "Description of the third feature and its benefits."),
          ],
        },
      ],
    },
  },

  {
    name: "footer-simple",
    description: "Logo, navigation columns, and copyright line",
    tags: ["layout", "navigation", "footer"],
    previewDescription:
      "A footer section with the brand name, three columns of navigation links (Product, Company, Support), and a copyright line at the bottom.",
    customisationKeys: ["brandName", "copyrightText"],
    tree: {
      type: "vbox",
      tag: "footer",
      styles: {
        padding: "60px 24px 24px",
        backgroundColor: "#111827",
        color: "#ffffff",
        gap: "40px",
      },
      children: [
        {
          type: "hbox",
          styles: {
            gap: "40px",
            maxWidth: "1200px",
            width: "100%",
            flexWrap: "wrap",
            alignSelf: "center",
          },
          children: [
            {
              type: "vbox",
              styles: { flex: "1 1 200px", gap: "16px" },
              children: [
                {
                  type: "text",
                  tag: "span",
                  value: "Brand",
                  styles: { fontSize: "20px", fontWeight: "700" },
                },
                {
                  type: "text",
                  tag: "p",
                  value: "Building great products.",
                  styles: {
                    fontSize: "14px",
                    color: "#9ca3af",
                  },
                },
              ],
            },
            makeFooterColumn("Product", ["Features", "Pricing", "Documentation"]),
            makeFooterColumn("Company", ["About", "Blog", "Careers"]),
            makeFooterColumn("Support", ["Help Centre", "Contact", "Status"]),
          ],
        },
        {
          type: "text",
          tag: "p",
          value: "© 2026 Brand. All rights reserved.",
          styles: {
            fontSize: "14px",
            color: "#6b7280",
            textAlign: "center",
            borderTopWidth: "1px",
            borderTopStyle: "solid",
            borderTopColor: "#374151",
            paddingTop: "24px",
          },
        },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Helper factories for repeated sub-structures
// ---------------------------------------------------------------------------

function makeCardInstance(title: string, body: string): PlasmicElement {
  return {
    type: "vbox",
    styles: {
      flex: "1 1 300px",
      borderRadius: "12px",
      overflow: "hidden",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "#e5e7eb",
      backgroundColor: "#ffffff",
    },
    children: [
      {
        type: "img",
        src: "https://placehold.co/400x240",
        styles: {
          width: "100%",
          height: "240px",
          objectFit: "cover",
        },
        attrs: { alt: "Card image" },
      },
      {
        type: "vbox",
        styles: { padding: "24px", gap: "12px" },
        children: [
          {
            type: "text",
            tag: "h3",
            value: title,
            styles: { fontSize: "20px", fontWeight: "600" },
          },
          {
            type: "text",
            tag: "p",
            value: body,
            styles: { fontSize: "14px", color: "#666666" },
          },
          {
            type: "text",
            tag: "a",
            value: "Read more →",
            styles: {
              fontSize: "14px",
              color: "#0070f3",
              fontWeight: "500",
            },
            attrs: { href: "#" },
          },
        ],
      },
    ],
  };
}

function makeFeatureColumn(
  icon: string,
  title: string,
  body: string
): PlasmicElement {
  return {
    type: "vbox",
    styles: {
      flex: "1 1 300px",
      padding: "32px",
      backgroundColor: "#ffffff",
      borderRadius: "12px",
      gap: "16px",
      alignItems: "center",
      borderWidth: "1px",
      borderStyle: "solid",
      borderColor: "#e5e7eb",
    },
    children: [
      {
        type: "text",
        tag: "span",
        value: icon,
        styles: { fontSize: "32px" },
      },
      {
        type: "text",
        tag: "h3",
        value: title,
        styles: { fontSize: "20px", fontWeight: "600" },
      },
      {
        type: "text",
        tag: "p",
        value: body,
        styles: {
          fontSize: "16px",
          color: "#666666",
          textAlign: "center",
        },
      },
    ],
  };
}

function makeFooterColumn(title: string, links: string[]): PlasmicElement {
  return {
    type: "vbox",
    styles: { flex: "1 1 150px", gap: "12px" },
    children: [
      {
        type: "text",
        tag: "span",
        value: title,
        styles: {
          fontSize: "14px",
          fontWeight: "600",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        },
      },
      ...links.map(
        (label): PlasmicElement => ({
          type: "text",
          tag: "a",
          value: label,
          styles: { fontSize: "14px", color: "#9ca3af" },
          attrs: { href: "#" },
        })
      ),
    ],
  };
}

// ---------------------------------------------------------------------------
// User-defined patterns (loaded from disk)
// ---------------------------------------------------------------------------

function loadUserPatterns(): PatternDefinition[] {
  const dir =
    process.env.PLASMIC_MCP_PATTERNS_DIR || ".plasmic/patterns";
  const absDir = path.resolve(dir);

  if (!fs.existsSync(absDir)) {
    return [];
  }

  const results: PatternDefinition[] = [];
  let files: string[];
  try {
    files = fs.readdirSync(absDir).filter((f) => f.endsWith(".pattern.json"));
  } catch {
    return [];
  }

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(absDir, file), "utf-8");
      const parsed = JSON.parse(raw) as PatternDefinition;
      if (parsed.name && parsed.tree) {
        results.push({
          name: parsed.name,
          description: parsed.description || "",
          tags: parsed.tags || [],
          previewDescription: parsed.previewDescription || "",
          customisationKeys: parsed.customisationKeys || [],
          tree: parsed.tree,
        });
      }
    } catch {
      // Skip malformed pattern files silently
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Merged registry — user patterns override built-ins on name collision
// ---------------------------------------------------------------------------

let cachedPatterns: PatternDefinition[] | null = null;

/**
 * Returns all available patterns (built-in + user-defined).
 * User patterns override built-ins on name collision.
 */
export function getAllPatterns(): PatternDefinition[] {
  if (cachedPatterns) return cachedPatterns;

  const builtinMap = new Map(
    BUILTIN_PATTERNS.map((p) => [p.name, p])
  );
  const userPatterns = loadUserPatterns();
  for (const up of userPatterns) {
    builtinMap.set(up.name, up); // user overrides built-in
  }
  cachedPatterns = Array.from(builtinMap.values());
  return cachedPatterns;
}

/**
 * Look up a pattern by name. Returns undefined if not found.
 */
export function getPattern(name: string): PatternDefinition | undefined {
  return getAllPatterns().find((p) => p.name === name);
}

/**
 * Returns the public metadata for all patterns (no tree included).
 */
export function listPatternsMeta(): Array<{
  name: string;
  description: string;
  tags: string[];
  previewDescription: string;
  customisationKeys: string[];
}> {
  return getAllPatterns().map((p) => ({
    name: p.name,
    description: p.description,
    tags: p.tags,
    previewDescription: p.previewDescription,
    customisationKeys: p.customisationKeys,
  }));
}

/**
 * Reset the pattern cache — useful for tests.
 */
export function resetPatternCache(): void {
  cachedPatterns = null;
}
