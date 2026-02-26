# MCP Eval Visual Capture

## Jobs to Be Done
- As an MCP developer, I want the eval system to authenticate with Plasmic Studio in a browser, navigate to the correct component/page, and capture a screenshot of the editor view so that the LLM judge can visually assess the output.

## Acceptance Criteria

### Authentication
- [ ] Eval runner launches a Playwright browser and authenticates with Plasmic Studio using the existing auth flow:
  1. GET `/api/v1/auth/csrf` to obtain a CSRF token
  2. POST `/api/v1/auth/login` with email + password + CSRF token
  3. GET `/api/v1/auth/csrf` to refresh the CSRF token post-login
  4. Store session cookies (`connect.sid`) for subsequent navigation
- [ ] Auth credentials are supplied via environment variables: `PLASMIC_STUDIO_EMAIL`, `PLASMIC_STUDIO_PASSWORD`
- [ ] `PLASMIC_AUTH_HOST` is used as the base URL (e.g., `http://localhost:3003` for local dev or a hosted instance)
- [ ] Browser session is reused across tasks within an eval run (authenticate once, not per-task)
- [ ] If auth fails, the eval run logs the error and skips all visual capture (state checks still run)

### Navigation
- [ ] After each eval task completes, the eval runner calls `inspect.preview-url` via MCP to get the Studio URL for the component/page that was created or modified
- [ ] Playwright navigates to the Studio URL: `{host}/projects/{projectId}`
- [ ] The runner waits for the Studio to fully load by checking for the canvas container inside the nested iframe structure:
  ```
  page → iframe.studio-frame → iframe.__wab_studio-frame → .canvas-editor__canvas-container
  ```
- [ ] Navigation timeout is configurable (default: 60 seconds) to account for Studio load time
- [ ] If the task modified a specific component, the eval runner navigates to that component within Studio (component tree selection)

### Screenshot Capture
- [ ] Desktop screenshot captured at 1280x800 viewport
- [ ] For scenarios with responsive/mobile variants, additional screenshot at 375x812
- [ ] Screenshots are saved as PNG to `evals/results/screenshots/{run-id}/{task-id}-{viewport}.png`
- [ ] Screenshot captures the full Studio editor view (tree panel + canvas + right panel) — NOT just the preview frame
- [ ] If Studio shows a loading spinner or error state, the screenshot is captured anyway and flagged

### Infrastructure
- [ ] Visual capture reuses patterns from the existing Playwright test infrastructure at `platform/wab/playwright/`:
  - Auth: `playwright/utils/api-client.ts` pattern (CSRF → login → cookies)
  - Navigation: `playwright/utils/studio-utils.ts` `goToProject()` + `waitForFrameToLoad()`
  - Frame access: nested `frameLocator` pattern for Studio iframe structure
- [ ] Playwright is configured with:
  - `actionTimeout: 10_000`
  - `trace: "retain-on-failure"`
  - `screenshot: "only-on-failure"` for Playwright's own screenshots (our eval screenshots are always captured)
- [ ] Visual capture is an optional step — if `--no-visual` flag is passed, it's skipped entirely (useful for fast CI runs)

## Happy Path
1. Eval run starts; Playwright launches browser
2. Browser authenticates with Studio (CSRF → login → cookies)
3. Claude completes an eval task via MCP tools
4. Eval runner calls `inspect.preview-url` to get the Studio URL
5. Playwright navigates to `{host}/projects/{projectId}`
6. Waits for Studio canvas to load (iframe → iframe → canvas container)
7. Captures full-page screenshot of the editor view at 1280x800
8. Saves screenshot to `evals/results/screenshots/`
9. Screenshot + prompt + transcript sent to multimodal LLM judge
10. Repeat steps 3-9 for each task
11. Browser session closed after all tasks complete

## Edge Cases
| Scenario | Expected behaviour |
|----------|-------------------|
| Studio fails to load within timeout | Log timeout error, save whatever screenshot is visible, mark visual capture as failed, continue to next task |
| Studio shows auth error / redirect to login | Re-authenticate once; if still fails, skip visual capture for remaining tasks |
| Component was deleted by the eval task | Navigate to project root instead; screenshot shows project overview |
| Multiple components modified in one task | Screenshot the last component modified (as reported by the transcript) |
| Studio is not running (local dev) | Visual capture step skipped with warning; state checks still run |
| Browser crashes mid-eval | Relaunch browser, re-authenticate, continue from next task |

## Out of Scope
- Recording video of the eval task execution in Studio
- Interacting with Studio UI elements (clicking, dragging) — we only observe/screenshot
- Supporting multiple browser types (Chromium only via Playwright)
- Capturing Studio in dark mode vs light mode variants
