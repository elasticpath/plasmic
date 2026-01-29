/**
 * Elastic Path Brand Color Tokens
 *
 * This module defines the EP green color scale and maps Plasmic's
 * blue tokens to EP green equivalents for runtime override.
 *
 * Color scale follows Radix UI conventions (1-12, light to dark).
 * Sources: Commerce Manager tailwind.css green-100 through green-900
 */

// EP Green color scale (Light Mode)
export const epGreen = {
  1: "#F5FCF8", // Extrapolated - lightest
  2: "#F0FAF5", // CM green-100
  3: "#C8F0DC", // CM green-200
  4: "#ADE9CC", // Extrapolated
  5: "#9BE4C1", // CM green-300
  6: "#6DD9A4", // Extrapolated
  7: "#5CCF96", // CM green-400
  8: "#2BC47E", // CM green-500
  9: "#07AB5B", // CM green-600 - PRIMARY
  10: "#0E9650", // Extrapolated
  11: "#1F8254", // CM green-700
  12: "#051C11", // CM green-900 - darkest
} as const;

// EP Green color scale (Dark Mode)
export const epGreenDark = {
  1: "#0D1912",
  2: "#0F1F17",
  3: "#12291D",
  4: "#153223",
  5: "#193B29",
  6: "#1E4830",
  7: "#24583A",
  8: "#2D7048",
  9: "#2BC47E",
  10: "#3DD68D",
  11: "#5EE8A3",
  12: "#C8F5DC",
} as const;

/**
 * Map Plasmic blue tokens to EP green equivalents
 * These overrides replace Plasmic's default blue (#0091ff) with EP green
 */
export const tokenOverrides: Record<string, string> = {
  "--token-yqAf_E0HIjU": epGreen[3], // blue-3 (#edf6ff) → soft backgrounds
  "--token-dqEx_KxIoYV": epGreen[4], // blue-4 (#e1f0ff) → soft backgrounds
  "--token-RhvOnhv_xIi": epGreen[5], // blue-5 (#cee7fe) → active backgrounds
  "--token-D666zt2IZPL": epGreen[9], // blue-9 (#0091ff) → PRIMARY buttons
  "--token-mu3x63xzJRW": epGreen[10], // blue-10 (#0081f1) → hover states
  "--token-VUsIDivgUss": epGreen[11], // blue-11 (#006adc) → link text
  "--token-qP8a3gYPq7fd": epGreen[9], // brand color → outline/focus color
  "--token-O9Cf1BVdg": `${epGreen[9]}80`, // focus ring (green with 50% opacity)
};

/**
 * Apply EP brand token overrides by injecting a <style> element
 *
 * We inject CSS that targets [class*="plasmic_tokens"] which matches
 * the hashed CSS module class names. This has higher specificity than
 * the original .plasmic_tokens definitions.
 */
export function applyEpBrandTokens(): void {
  // Check if already injected
  if (document.getElementById("ep-brand-tokens")) {
    return;
  }

  // Build CSS rules for token overrides
  const tokenRules = Object.entries(tokenOverrides)
    .map(([token, value]) => `  ${token}: ${value};`)
    .join("\n");

  // Create style element with high-specificity selector
  // Use repeated attribute selectors and !important to ensure override
  const style = document.createElement("style");
  style.id = "ep-brand-tokens";
  style.textContent = `
/* Elastic Path Brand Token Overrides */
html body [class*="plasmic_tokens"][class*="plasmic_tokens"],
html body [class*="plasmic_tokens"],
[class*="plasmic_tokens"][class*="plasmic_tokens"][class*="plasmic_tokens"] {
${tokenRules}
}

/* Additional overrides for focus states that may be defined elsewhere */
:root,
html,
body,
* {
${Object.entries(tokenOverrides)
    .map(([token, value]) => `  ${token}: ${value} !important;`)
    .join("\n")}
}
`;

  // Inject at end of head so it loads after Plasmic styles
  document.head.appendChild(style);
}
