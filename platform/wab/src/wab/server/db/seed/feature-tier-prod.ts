import { DbMgr, SUPER_USER } from "@/wab/server/db/DbMgr";
import { FeatureTier } from "@/wab/server/entities/Entities";
import { EntityManager } from "typeorm";

/**
 * Production feature tiers for self-hosted Elastic Path environments.
 * All Stripe IDs are null — billing is handled externally.
 */
export async function seedProdFeatureTiers(em: EntityManager) {
  const db = new DbMgr(em, SUPER_USER);
  return {
    starterFt: await db.addFeatureTier(starterFt),
    enterpriseFt: await db.addFeatureTier(enterpriseFt),
  };
}

const starterFt: FeatureTier = {
  name: "Starter",
  monthlyBasePrice: null,
  monthlyBaseStripePriceId: null,
  annualBasePrice: null,
  annualBaseStripePriceId: null,
  monthlySeatPrice: 0,
  monthlySeatStripePriceId: "",
  annualSeatPrice: 0,
  annualSeatStripePriceId: "",
  minUsers: 1,
  maxUsers: 3,
  monthlyViews: 100_000,
  versionHistoryDays: 30,
  analytics: false,
  contentRole: false,
  designerRole: false,
  editContentCreatorMode: false,
  localization: false,
  splitContent: false,
  privateUsersIncluded: null,
  maxPrivateUsers: null,
  publicUsersIncluded: null,
  maxPublicUsers: null,
  maxWorkspaces: null,
} as FeatureTier;

const enterpriseFt: FeatureTier = {
  name: "Enterprise",
  monthlyBasePrice: null,
  monthlyBaseStripePriceId: null,
  annualBasePrice: null,
  annualBaseStripePriceId: null,
  monthlySeatPrice: 0,
  monthlySeatStripePriceId: "",
  annualSeatPrice: 0,
  annualSeatStripePriceId: "",
  minUsers: 1,
  maxUsers: 1_000,
  monthlyViews: 1_000_000,
  versionHistoryDays: 180,
  analytics: true,
  contentRole: true,
  designerRole: true,
  editContentCreatorMode: true,
  localization: true,
  splitContent: true,
  privateUsersIncluded: null,
  maxPrivateUsers: null,
  publicUsersIncluded: null,
  maxPublicUsers: null,
  maxWorkspaces: null,
} as FeatureTier;
