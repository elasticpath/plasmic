<<<<<<< HEAD
/** @jest-environment node */
import { DbMgr, SUPER_USER, normalActor } from "@/wab/server/db/DbMgr";
import { Permission, Team } from "@/wab/server/entities/Entities";
=======
/** @vitest-environment node */
import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
>>>>>>> upstream/master
import { SharedApiTester } from "@/wab/server/test/api-tester";
import { createBackend, createDatabase } from "@/wab/server/test/backend-util";
import {
  BadRequestError,
  PreconditionFailedError,
  UnauthorizedError,
} from "@/wab/shared/ApiErrors/errors";
import type { DataSource } from "typeorm";
import * as uuid from "uuid";
import { MAX_GRANTS_PER_REQUEST, TeamId } from "@/wab/shared/ApiSchema";
import { MAX_PASSWORD_LENGTH } from "@/wab/shared/password-policy";

describe("auth", () => {
  let api: SharedApiTester;
  let sudoDbMgr: DbMgr;
  let baseURL: string;
  let cleanup: () => Promise<void>;
  let con: DataSource;

  // Helper to create a pending invitation for an email
  // This is required because signup is invitation-only
  // Uses entity manager directly since SUPER_USER cannot create teams via DbMgr
  // Returns the team ID so it can be cleaned up if needed
  async function createPendingInvitation(email: string): Promise<string> {
    const em = con.createEntityManager();
    const now = new Date();

    const team = em.create(Team, {
      id: uuid.v4(),
      name: `Inviting Team ${Date.now()}`,
      billingEmail: "test@test.com",
      createdAt: now,
      updatedAt: now,
    });
    await em.save(team);

    const permission = em.create(Permission, {
      id: uuid.v4(),
      email: email,
      teamId: team.id,
      accessLevel: "editor",
      createdAt: now,
      updatedAt: now,
    });
    await em.save(permission);

    return team.id;
  }

  beforeAll(async () => {
    const { dburi, con: connection, cleanup: cleanupDatabase } = await createDatabase();
    con = connection;
    sudoDbMgr = new DbMgr(con.createEntityManager(), SUPER_USER);
    await sudoDbMgr.setDevFlagOverrides(
      JSON.stringify({ blockedSignupDomains: ["bad.com", "bad.good.com"] })
    );

    const { host, cleanup: cleanupBackend } = await createBackend(dburi);
    baseURL = `${host}/api/v1`;

    cleanup = async () => {
      await cleanupBackend();
      await cleanupDatabase();
    };
  });

  beforeEach(async () => {
    api = new SharedApiTester(baseURL);
    await api.refreshCsrfToken();
  });

  afterEach(async () => {
    await api.dispose();
  });

  afterAll(async () => {
    await cleanup();
  });

  it("rejects signup without invitation", async () => {
    const email = `${Date.now()}@example.com`;
    expect(
      await api.signUp({
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      })
    ).toEqual({
      status: false,
      reason: "BadEmailError",
    });
  });

  it("can signup, logout, login with invitation", async () => {
    const email = `${Date.now()}@example.com`;
    await createPendingInvitation(email);
    expect(
      await api.signUp({
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      })
    ).toMatchObject({
      status: true,
      user: {
        email,
        firstName: "GivenName",
        lastName: "FamilyName",
      },
    });
    expect(await api.getSelfInfo()).toMatchObject({
      user: { email },
    });
    await api.logout();
    await expect(api.getSelfInfo()).rejects.toThrow(UnauthorizedError);
    await api.login({
      email,
      password: "SuperStrongPassword!!",
    });
    expect(await api.getSelfInfo()).toMatchObject({
      user: { email },
    });
  });

  describe("signup", () => {
    it("rejects weak passwords", async () => {
      const email = `${Date.now()}@example.com`;
      await createPendingInvitation(email);
      expect(
        await api.signUp({
          email,
          password: "1234",
          firstName: "GivenName",
          lastName: "FamilyName",
        })
      ).toEqual({
        status: false,
        reason: "WeakPasswordError",
      });
    });

    it("rejects passwords that are too long", async () => {
      const email = `${Date.now()}@example.com`;
      // EP's invitation gate runs before password validation.
      await createPendingInvitation(email);
      const signUpParams = {
        email,
        password: "SuperStrongPassword!!" + "a".repeat(MAX_PASSWORD_LENGTH),
        firstName: "GivenName",
        lastName: "FamilyName",
      };
      expect(await api.signUp(signUpParams)).toEqual({
        status: false,
        reason: "PasswordTooLongError",
      });

      signUpParams.password = signUpParams.password.slice(
        0,
        MAX_PASSWORD_LENGTH
      );
      expect(await api.signUp(signUpParams)).toMatchObject({
        status: true,
      });
    });

    it("rejects if email already used", async () => {
      const email = `${Date.now()}@example.com`;
      await createPendingInvitation(email);
      const data = {
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      };
      expect(await api.signUp(data)).toMatchObject({
        status: true,
      });
      // Create another invitation for the same email before second signup attempt
      await createPendingInvitation(email);
      expect(await api.signUp(data)).toMatchObject({
        status: false,
        reason: "EmailSent",
      });
    });

    it("rejects blocked domains", async () => {
      const badEmails = [
        `${Date.now()}@bad.com`,
        `${Date.now()}@very.bad.com`,
        `${Date.now()}@extra.very.bad.com`,
        `${Date.now()}@bad.good.com`,
      ];
      for (const email of badEmails) {
        await createPendingInvitation(email);
        await expect(
          api.signUp({
            email,
            password: "SuperStrongPassword!!",
            firstName: "GivenName",
            lastName: "FamilyName",
          })
        ).rejects.toThrow(BadRequestError);
      }

      const goodEmails = [
        `${Date.now()}@good.com`,
        `${Date.now()}@notbad.com`,
        `bad.com.${Date.now()}@good.com`,
      ];
      for (const email of goodEmails) {
        await createPendingInvitation(email);
        await expect(
          api.signUp({
            email,
            password: "SuperStrongPassword!!",
            firstName: "GivenName",
            lastName: "FamilyName",
          })
        ).resolves.toMatchObject({ status: true });
      }
    });
  });

  describe("login", () => {
    it("is rate limited", async () => {
      await api.dispose();
      api = new SharedApiTester(baseURL, {
        "x-plasmic-test-rate-limit": "true",
      });
      await api.refreshCsrfToken();
      for (let i = 0; i < 20; ++i) {
        try {
          const res = await api.login({
            email: `${Date.now()}@example.com`,
            password: "SuperStrongPassword!!",
          });
          expect(res).toEqual({
            status: false,
            reason: "IncorrectLoginError",
          });
          expect(i).toBeLessThan(15);
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes("429")) {
            expect(i).toBeGreaterThanOrEqual(15);
          } else {
            throw error;
          }
        }
      }
    });
  });

  describe("grantRevoke", () => {
    it("is rate limited per user", async () => {
      await api.dispose();
      api = new SharedApiTester(baseURL);
      await api.refreshCsrfToken();
      const email = `${Date.now()}@example.com`;
      await createPendingInvitation(email);
      await api.signUp({
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      });
      const dbUser = await sudoDbMgr.getUserById(api.user()!.id);
      await sudoDbMgr.markEmailAsVerified(dbUser);

      api.setBaseHeader("x-plasmic-test-rate-limit", "true");

      for (let i = 0; i < 35; ++i) {
        try {
          await api.grantRevoke({ grants: [], revokes: [] });
          expect(i).toBeLessThan(30);
        } catch (error: unknown) {
          if (error instanceof Error && error.message.includes("429")) {
            expect(i).toBeGreaterThanOrEqual(30);
          } else {
            throw error;
          }
        }
      }
    });

    it("rejects more than the max grants per request", async () => {
      const email = `${Date.now()}@example.com`;
      await createPendingInvitation(email);
      await api.signUp({
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      });
      const dbUser = await sudoDbMgr.getUserById(api.user()!.id);
      await sudoDbMgr.markEmailAsVerified(dbUser);

      // The cap is enforced before any resource resolution, so the teamId
      // doesn't need to reference a real team.
      const grants = Array.from(
        { length: MAX_GRANTS_PER_REQUEST + 1 },
        (_, i) => ({
          email: `recipient-${i}@example.com`,
          teamId: "fake-team" as TeamId,
          accessLevel: "editor" as const,
        })
      );

      await expect(api.grantRevoke({ grants, revokes: [] })).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe("deleteSelf", () => {
    it("works", async () => {
      const email = `${Date.now()}@example.com`;
      const invitingTeamId = await createPendingInvitation(email);
      await api.signUp({
        email,
        password: "SuperStrongPassword!!",
        firstName: "GivenName",
        lastName: "FamilyName",
      });

      // Mark email as verified before the user is allowed to do anything.
      expect(api.user()).toBeDefined();
      const dbUser = await sudoDbMgr.getUserById(api.user()!.id);
      await sudoDbMgr.markEmailAsVerified(dbUser);

      // Create a non-personal team directly via DbMgr — POST /api/v1/teams is
      // admin-gated on the EP fork, and this test is about deleteSelf.
      const userDbMgr = new DbMgr(con.createEntityManager(), normalActor(dbUser.id));
      const team = await userDbMgr.createTeam("Example team");

      // User should have 2 teams now, one personal, one non-personal.
      await expect(api.listTeams()).resolves.toMatchObject({
        teams: expect.arrayContaining([
          expect.objectContaining({
            name: "Personal team",
          }),
          expect.objectContaining({
            name: "Example team",
          }),
        ]),
      });

      // User should not be able to delete themselves,
      // since there would be a team left without an owner.
      await expect(api.deleteSelf()).rejects.toThrow(PreconditionFailedError);
      expect(api.user()).toBeDefined();
      await expect(api.getSelfInfo()).resolves.toMatchObject({
        user: { email },
      });

      // Delete the non-personal team.
      await api.deleteTeam(team.id);

      // Clean up the inviting team (user only has editor access, so delete directly)
      const em = con.createEntityManager();
      await em.delete(Permission, { teamId: invitingTeamId });
      await em.delete(Team, { id: invitingTeamId });

      // User should be able to delete themselves now.
      await api.deleteSelf();
      expect(api.user()).toBeUndefined();
      await expect(api.getSelfInfo()).rejects.toThrow(UnauthorizedError);

      // User should not be able to login again.
      await expect(
        api.login({
          email,
          password: "SuperStrongPassword!!",
        })
      ).resolves.toMatchObject({
        status: false,
        reason: "IncorrectLoginError",
      });
    });
  });
});
