# Eval Scenario Index

Total: 135 scenarios

## Simple (66)

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
| variant-list-code-component | variant, component | tool-sequence, tool-params, no-errors, count | 60s |
| node-remove-element | node | tool-sequence, tool-params, no-errors, count | 90s |
| node-clone-element | node | tool-sequence, tool-params, no-errors, count | 90s |
| design-remove-token | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-duplicate-token | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-list-mixins | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-update-mixin | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-remove-mixin | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-list-animations | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-update-animation | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-remove-animation | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-list-themes | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-create-theme | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-update-theme | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-remove-theme | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-set-active-theme | design | tool-sequence, tool-params, no-errors, count | 90s |
| design-list-assets | design | tool-sequence, tool-params, no-errors, count | 60s |
| design-rename-asset | design | tool-sequence, tool-params, count | 90s |
| design-remove-asset | design | tool-sequence, tool-params, count | 90s |
| data-list-data-tokens | data | tool-sequence, tool-params, no-errors, count | 60s |
| data-create-data-token | data | tool-sequence, tool-params, no-errors, count | 60s |
| data-update-data-token | data | tool-sequence, tool-params, no-errors, count | 90s |
| data-remove-data-token | data | tool-sequence, tool-params, no-errors, count | 90s |
| data-list-splits | data | tool-sequence, tool-params, no-errors, count | 60s |
| data-create-split | data | tool-sequence, tool-params, no-errors, count | 60s |
| data-update-split | data | tool-sequence, tool-params, no-errors, count | 90s |
| data-remove-split | data | tool-sequence, tool-params, no-errors, count | 90s |
| data-get-code-meta | data, component | tool-sequence, tool-params, no-errors, count | 60s |
| data-list-functions | data | tool-sequence, tool-params, no-errors, count | 60s |
| component-delete | component | tool-sequence, tool-params, no-errors, count | 90s |
| component-convert-to-page | component | tool-sequence, tool-params, no-errors, count | 90s |
| component-convert-to-component | component | tool-sequence, tool-params, no-errors, count | 90s |
| component-list-props | component | tool-sequence, tool-params, no-errors, count | 60s |
| component-list-states | component | tool-sequence, tool-params, no-errors, count | 60s |
| variant-list-global-groups | variant | tool-sequence, tool-params, no-errors, count | 60s |
| variant-create-global-group | variant | tool-sequence, tool-params, no-errors, count | 60s |
| variant-add-global | variant | tool-sequence, tool-params, no-errors, count | 90s |
| variant-remove-global-group | variant | tool-sequence, tool-params, no-errors, count | 90s |
| variant-rename-global | variant | tool-sequence, tool-params, no-errors, count | 90s |
| variant-update-screen | variant | tool-sequence, tool-params, no-errors, count | 90s |
| inspect-subtree | inspect | tool-sequence, tool-params, no-errors, count | 90s |
| inspect-export | inspect | tool-sequence, tool-params, no-errors, count | 90s |
| inspect-style-properties | inspect | tool-sequence, tool-params, no-errors, count | 60s |
| inspect-preview-url | inspect | tool-sequence, tool-params, no-errors, count | 60s |
| inspect-page-meta | inspect | tool-sequence, tool-params, no-errors, count | 60s |
| project-set | project | tool-sequence, tool-params, no-errors, count | 60s |

## Medium (50)

| ID | Domains | Graders | Timeout |
|---|---|---|---|
| data-verify-query | data, component | tool-sequence, tool-params, existence, data, count, no-errors | 120s |
| data-verify-interaction | data, component, node, interaction | tool-sequence, tool-params, existence, count, no-errors | 150s |
| interaction-conditional-click | interaction, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
| interaction-multi-handler | interaction, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
| interaction-onchange-handler | interaction, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
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
| node-verify-styles | node, component, inspect | tool-sequence, tool-params, existence, property, count, no-errors | 150s |
| node-verify-structure | node, component, inspect | tool-sequence, tool-params, existence, structure, count, no-errors | 150s |
| project-batch-workflow | project, design | tool-sequence, tool-params, existence, count, no-errors | 150s |
| project-save-refresh | project, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| variant-resolve-code-component | variant, node, component, inspect | tool-sequence, tool-params, no-errors, count | 90s |
| node-move-element | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-reorder-children | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-update-rich-text | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-update-attrs | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-set-visibility | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-set-image | node, component | tool-sequence, tool-params, existence, count, no-errors | 150s |
| node-detach-mixin | node, design, component | tool-sequence, tool-params, count, no-errors | 150s |
| node-add-animation | node, design, component | tool-sequence, tool-params, count, no-errors | 150s |
| node-remove-animation | node, design, component | tool-sequence, tool-params, count, no-errors | 150s |
| data-update-query | data, component | tool-sequence, tool-params, count, no-errors | 120s |
| data-remove-query | data, component | tool-sequence, tool-params, count, no-errors | 120s |
| component-add-prop | component | tool-sequence, tool-params, existence, count, no-errors | 120s |
| component-update-prop | component | tool-sequence, tool-params, count, no-errors | 120s |
| component-remove-prop | component | tool-sequence, tool-params, count, no-errors | 120s |
| component-add-state | component | tool-sequence, tool-params, existence, count, no-errors | 120s |
| component-remove-state | component | tool-sequence, tool-params, count, no-errors | 120s |
| variant-rename | variant, component | tool-sequence, tool-params, count, no-errors | 120s |
| variant-remove | variant, component | tool-sequence, tool-params, count, no-errors | 120s |
| interaction-update-handler | interaction, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |
| interaction-remove-handler | interaction, component, node | tool-sequence, tool-params, existence, count, no-errors | 150s |

## Complex (19)

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
| node-verify-multi-property | node, component, inspect | tool-sequence, tool-params, existence, structure, count, no-errors | 240s |
| project-multi-undo | project, component, design | tool-sequence, tool-params, existence, count, no-errors | 240s |
| project-compound-state | project, design, component, node, inspect | tool-sequence, tool-params, existence, count, no-errors | 240s |
| variant-create-style-code-component | variant, node, component, inspect | tool-sequence, tool-params, no-errors, count | 120s |
