# Eval Scenario Index

Total: 55 scenarios

## Simple (20)

| ID | Domains | Graders | Timeout |
|---|---|---|---|
| component-create-page | component | tool-sequence, tool-params, no-errors, existence | 90s |
| component-node-card | component, node | tool-sequence, existence, no-errors, count | 120s |
| node-design-style | node, design | tool-sequence, tool-params, no-errors, count | 90s |
| data-list-queries | data | tool-sequence, tool-params, no-errors | 60s |
| design-list-tokens | design | tool-sequence, tool-params, no-errors, count | 60s |
| inspect-summary | inspect | tool-sequence, no-errors, count | 60s |
| interaction-list | interaction | tool-sequence, no-errors, count | 60s |
| node-add-heading | node | tool-sequence, tool-params, no-errors, count | 90s |
| project-list | project | tool-sequence, tool-params, no-errors, count | 60s |
| design-upload-asset | design | tool-sequence, tool-params, count | 60s |
| design-rename-token | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-create-mixin | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-create-animation | design | tool-sequence, tool-params, no-errors, count | 60s |
| variant-create-screen | variant | tool-sequence, tool-params, no-errors, count | 60s |
| component-update-page-meta | component | tool-sequence, tool-params, no-errors, count | 90s |
| component-extract | component, inspect | tool-sequence, tool-params, no-errors, existence, count | 120s |
| project-undo | project, node | tool-sequence, tool-params, no-errors, count | 120s |
| node-dry-run | node | tool-sequence, tool-params, no-errors, count | 90s |
| design-create-token | design | tool-sequence, tool-params, no-errors, existence, count | 60s |
| variant-list | variant | tool-sequence, tool-params, no-errors | 60s |

## Medium (20)

| ID | Domains | Graders | Timeout |
|---|---|---|---|
| medium-info-card | component, node | tool-sequence, tool-params, existence, count, no-errors | 120s |
| medium-page-with-sections | component, node | tool-sequence, tool-params, existence, count, no-errors | 120s |
| medium-clone-and-rename | component | tool-sequence, tool-params, existence, count, no-errors | 120s |
| medium-styled-heading | node, inspect | tool-sequence, tool-params, count, no-errors | 120s |
| medium-nested-layout | node, inspect | tool-sequence, tool-params, count, no-errors | 120s |
| medium-style-with-new-token | design, node, inspect | tool-sequence, tool-params, existence, count, no-errors | 150s |
| medium-create-color-palette | design | tool-sequence, tool-params, existence, count, no-errors | 120s |
| medium-create-mixin | design, node, inspect | tool-sequence, tool-params, existence, count, no-errors | 150s |
| medium-button-with-hover | component, node, variant | tool-sequence, tool-params, existence, count, no-errors | 150s |
| medium-variant-group | component, variant | tool-sequence, tool-params, existence, count, no-errors | 120s |
| medium-screen-variant | variant, inspect | tool-sequence, tool-params, count, no-errors | 120s |
| medium-dynamic-text | node, data, inspect | tool-sequence, tool-params, count, no-errors | 150s |
| medium-conditional-element | node, data, inspect | tool-sequence, tool-params, count, no-errors | 150s |
| medium-data-repetition | node, data, inspect | tool-sequence, tool-params, count, no-errors | 150s |
| medium-button-with-navigation | node, interaction, inspect | tool-sequence, tool-params, count, no-errors | 150s |
| medium-styled-card | component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
| medium-hero-with-token | design, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
| medium-full-card | component, node, variant, design | tool-sequence, tool-params, existence, count, no-errors | 180s |
| medium-add-query | data, inspect | tool-sequence, tool-params, count, no-errors | 120s |
| medium-cta-button | component, node, interaction | tool-sequence, tool-params, existence, count, no-errors | 150s |

## Complex (15)

| ID | Domains | Graders | Timeout |
|---|---|---|---|
| complex-responsive-hero | component, node, variant, design | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-product-card-data | component, node, data, interaction | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-navbar | component, node, variant, design, interaction | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-blog-template | component, node, design, variant, inspect | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-contact-form | component, node, variant, design, interaction | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-feature-grid | component, node, data, design, inspect | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-testimonial | component, node, data, design, variant | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-dashboard-layout | component, node, design, variant, inspect | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-product-listing | component, node, data, design, variant, interaction | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-footer | component, node, design, interaction, inspect | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-modal-dialog | component, node, variant, design, interaction | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-alert-banner | component, node, variant, design, data | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-team-page | component, node, data, design, inspect, variant | tool-sequence, tool-params, existence, count, no-errors | 240s |
| complex-landing-page | component, node, design, variant, data, interaction, inspect | tool-sequence, tool-params, existence, count, no-errors | 300s |
| complex-pricing-section | component, node, variant, design, interaction, data | tool-sequence, tool-params, existence, count, no-errors | 240s |
