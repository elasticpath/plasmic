# Animations

## Jobs to Be Done
- As a Claude Code user building polished pages, I want to add CSS animations to elements so that pages have entrance effects, hover transitions, and motion
- As a Claude Code user, I want to manage animation sequences in the design system so that motion is consistent across the project

## Background

Studio's animation model: `AnimationSequence` (named keyframe collection at site level) → `Animation` (applied to element via RuleSet.animations[]). Animation has: sequence ref, duration, delay, timingFunction, iterationCount, direction, fillMode, playState. Variant-specific animation overrides are supported.

TplMgr provides: `addAnimationSequence()`, `removeAnimationSequence()`, `renameAnimationSequence()`, `duplicateAnimationSequence()`, `addAnimation()`.

## Implementation

Animation management as site-level operations in `component` domain, and element-level application in `node` domain.

### `component({ action: "create-animation" })`
- **Parameters**: `name`, `keyframes` (array of `{ offset: number, styles: Record<string,string> }`)
- Creates an AnimationSequence on the site
- Returns: `{ animationUuid, name }`

### `component({ action: "list-animations" })`
- **Parameters**: (none)
- Returns: Array of `{ animationUuid, name, keyframeCount }`

### `component({ action: "remove-animation" })`
- **Parameters**: `animationRef` (name or UUID)
- Removes sequence + cleans up element references

### `node({ action: "add-animation" })`
- **Parameters**: `componentUuid`, `nodeRef`, `animationRef` (name or UUID), `duration?` (default "1s"), `delay?` (default "0s"), `timingFunction?` (default "ease"), `iterationCount?` (default 1), `direction?`, `fillMode?`, `variant?`, `dryRun?`
- Adds animation to element's RuleSet.animations[]

### `node({ action: "remove-animation" })`
- **Parameters**: `componentUuid`, `nodeRef`, `animationRef`, `variant?`, `dryRun?`
- Removes animation from element

## Acceptance Criteria
- [x] Can create animation sequence with keyframes
- [x] Can list all animation sequences
- [x] Can apply animation to element with timing options
- [x] Can remove animation from element
- [x] Can remove animation sequence from site
- [x] `inspect({ action: "node" })` output includes `animations` array when element has animations
- [x] Variant-specific animations (different animation on hover variant)
- [x] Undo support
- [x] Batch mode support
- [x] Integration test: create animation → apply to element → read back → verify
- [x] Unit tests for all operations

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Apply same animation twice to element | Replace existing (update timing) |
| Remove animation used by elements | Clean up element references first |
| Keyframe offset not 0-1 | Error: "Keyframe offset must be between 0 and 1" |
| Invalid timing function | Accept as-is (CSS value) |
| Empty keyframes array | Error: "Animation must have at least one keyframe" |

## Out of Scope
- Scroll-triggered animations
- Animation orchestration (sequencing multiple animations)
- GSAP or non-CSS animation engines
