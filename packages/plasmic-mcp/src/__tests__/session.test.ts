/**
 * Unit tests for session.ts
 *
 * Session is a singleton that holds the active project's in-memory model.
 * Tests verify that tools depending on requireSession() get clear error
 * messages when no project is loaded, preventing confusing downstream failures.
 */

import {
  getSession,
  setSession,
  requireSession,
  clearSession,
} from "../session";
import type { Session } from "../session";

describe("session", () => {
  afterEach(() => {
    clearSession();
  });

  it("returns null when no session is set", () => {
    expect(getSession()).toBeNull();
  });

  it("stores and retrieves a session", () => {
    const session: Session = {
      projectId: "proj1",
      projectName: "Test Project",
      site: { components: [] },
      bundler: {},
    };
    setSession(session);
    expect(getSession()).toBe(session);
  });

  it("requireSession throws with actionable message when no session", () => {
    expect(() => requireSession()).toThrow("No active project");
    expect(() => requireSession()).toThrow("set-project");
  });

  it("requireSession returns the session when set", () => {
    const session: Session = {
      projectId: "proj1",
      projectName: "Test",
      site: {},
      bundler: {},
    };
    setSession(session);
    expect(requireSession()).toBe(session);
  });

  it("clearSession removes the active session", () => {
    setSession({
      projectId: "proj1",
      projectName: "Test",
      site: {},
      bundler: {},
    });
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("replaces session when set again with different project", () => {
    setSession({
      projectId: "proj1",
      projectName: "First",
      site: {},
      bundler: {},
    });

    const second: Session = {
      projectId: "proj2",
      projectName: "Second",
      site: { components: [1, 2, 3] },
      bundler: {},
    };
    setSession(second);

    expect(getSession()).toBe(second);
    expect(getSession()?.projectId).toBe("proj2");
  });
});
