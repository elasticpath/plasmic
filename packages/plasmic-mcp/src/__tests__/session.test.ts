/**
 * Unit tests for session.ts
 *
 * Session is a singleton that holds the active project's in-memory model.
 * Tests verify that tools depending on requireSession() get clear error
 * messages when no project is loaded, preventing confusing downstream failures.
 *
 * M2: Session now includes revision tracking fields (revisionNum, modelVersion,
 * hostlessDataVersion, projectUuid) needed for incremental saves.
 */

import {
  getSession,
  setSession,
  requireSession,
  clearSession,
} from "../session";
import type { Session } from "../session";

/** Helper to create a valid session with all required M2 fields. */
function makeSession(overrides?: Partial<Session>): Session {
  return {
    projectId: "proj1",
    projectName: "Test Project",
    site: { components: [] },
    bundler: {},
    revisionNum: 1,
    modelVersion: 0,
    hostlessDataVersion: 0,
    projectUuid: "proj1",
    ...overrides,
  };
}

describe("session", () => {
  afterEach(() => {
    clearSession();
  });

  it("returns null when no session is set", () => {
    expect(getSession()).toBeNull();
  });

  it("stores and retrieves a session", () => {
    const session = makeSession();
    setSession(session);
    expect(getSession()).toBe(session);
  });

  it("requireSession throws with actionable message when no session", () => {
    expect(() => requireSession()).toThrow("No active project");
    expect(() => requireSession()).toThrow("set-project");
  });

  it("requireSession returns the session when set", () => {
    const session = makeSession();
    setSession(session);
    expect(requireSession()).toBe(session);
  });

  it("clearSession removes the active session", () => {
    setSession(makeSession());
    clearSession();
    expect(getSession()).toBeNull();
  });

  it("replaces session when set again with different project", () => {
    setSession(makeSession());

    const second = makeSession({
      projectId: "proj2",
      projectName: "Second",
      site: { components: [1, 2, 3] },
      revisionNum: 5,
      projectUuid: "proj2",
    });
    setSession(second);

    expect(getSession()).toBe(second);
    expect(getSession()?.projectId).toBe("proj2");
  });

  // M2: verify revision tracking fields are stored and accessible
  it("stores revision tracking fields", () => {
    const session = makeSession({
      revisionNum: 42,
      modelVersion: 7,
      hostlessDataVersion: 3,
      projectUuid: "bundle-uuid-123",
    });
    setSession(session);

    const retrieved = requireSession();
    expect(retrieved.revisionNum).toBe(42);
    expect(retrieved.modelVersion).toBe(7);
    expect(retrieved.hostlessDataVersion).toBe(3);
    expect(retrieved.projectUuid).toBe("bundle-uuid-123");
  });

  it("allows mutable revisionNum update (for save-manager)", () => {
    const session = makeSession({ revisionNum: 10 });
    setSession(session);

    // save-manager increments revisionNum directly after successful save
    session.revisionNum = 11;
    expect(requireSession().revisionNum).toBe(11);
  });
});
