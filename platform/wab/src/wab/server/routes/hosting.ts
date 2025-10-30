import { DbMgr } from "@/wab/server/db/DbMgr";
import {
  checkDnsConfiguration,
  deployProjectToHosting,
} from "@/wab/server/hosting/deploy";
import { userDbMgr } from "@/wab/server/routes/util";
import {
  CheckDomainResponse,
  CheckDomainStatus,
  DomainsForProjectResponse,
  PlasmicHostingSettings,
  ProjectId,
  RevalidatePlasmicHostingRequest,
  RevalidatePlasmicHostingResponse,
  SetCustomDomainForProjectResponse,
  SetDomainStatus,
  SetSubdomainForProjectResponse,
} from "@/wab/shared/ApiSchema";
import { DEVFLAGS } from "@/wab/shared/devflags";
import { PLASMIC_HOSTING_DOMAIN_VALIDATOR } from "@/wab/shared/hosting";
import { Request, Response } from "express";
import { logger } from "../observability";

// Constants for key-value storage (placeholders for future implementation)
// const HOSTING_SUBDOMAIN_KEY = "hosting.subdomain";
// const HOSTING_CUSTOM_DOMAINS_KEY = "hosting.customDomains";
// const HOSTING_SETTINGS_KEY = "hosting.settings";

// Helper function to separate subdomain from custom domains
function separateDomainsForProject(
  domains: string[],
  subdomainSuffix: string
): {
  subdomain?: string;
  customDomains: string[];
} {
  const subdomain = domains.find((d) => d.endsWith(subdomainSuffix));
  const customDomains = domains.filter((d) => !d.endsWith(subdomainSuffix));
  return { subdomain, customDomains };
}

// Helper to get subdomain suffix
function getSubdomainSuffix(): string {
  return DEVFLAGS.plasmicHostingSubdomainSuffix;
}

// GET /api/v1/check-domain
export async function checkDomain(req: Request, res: Response): Promise<void> {
  let { domain } = req.query as { domain: string };

  if (!domain) {
    res.status(400).json({ error: "Domain parameter required" });
    return;
  }

  // Strip quotes if they were included in the domain
  domain = domain.replace(/^["']|["']$/g, "");

  const mgr = userDbMgr(req);
  const subdomainSuffix = getSubdomainSuffix();
  const validator = PLASMIC_HOSTING_DOMAIN_VALIDATOR;

  try {
    // Validate domain format
    if (!validator.isValidDomainOrSubdomain(domain)) {
      const status: CheckDomainStatus = {
        isValid: false,
      };
      res.json({ status } satisfies CheckDomainResponse);
      return;
    }

    // Check if domain is already used
    const projectsUsingDomain = await getProjectsUsingDomain(mgr, domain);
    const configuredBy =
      projectsUsingDomain.length > 0
        ? `project:${projectsUsingDomain[0].id}`
        : undefined;

    // For now, simulate DNS configuration check
    // TODO: Implement actual DNS checking
    const isCorrectlyConfigured = await checkDnsConfiguration(domain);

    const status: CheckDomainStatus = {
      isValid: true,
      isAvailable: projectsUsingDomain.length === 0,
      isPlasmicSubdomain: domain.endsWith(subdomainSuffix),
      isAnyPlasmicDomain: validator.isAnyPlasmicDomain(domain),
      isCorrectlyConfigured,
      configuredBy,
    };
    res.json({ status } satisfies CheckDomainResponse);
  } catch (error) {
    console.error("Domain check error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
}

// Helper function to find projects using a domain
async function getProjectsUsingDomain(mgr: DbMgr, domain: string) {
  // Use the built-in method that already exists in DbMgr
  try {
    const projectId = await mgr.tryGetProjectIdForDomain(domain);
    if (projectId) {
      const project = await mgr.getProjectById(projectId);
      return [project];
    }
    return [];
  } catch (e) {
    // Project might have been deleted or other error
    return [];
  }
}

// GET /api/v1/domains-for-project/:projectId
export async function getDomainsForProject(
  req: Request,
  res: Response
): Promise<void> {
  const { projectId } = req.params;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "viewer",
      "get domains"
    );

    // Get domains using the existing DbMgr method
    const domains = await mgr.getDomainsForProject(projectId as ProjectId);

    res.json({ domains } satisfies DomainsForProjectResponse);
  } catch (error: any) {
    console.error("Get domains error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to get domains" });
    }
  }
}

// PUT /api/v1/subdomain-for-project
export async function setSubdomainForProject(
  req: Request,
  res: Response
): Promise<void> {
  const { subdomain, projectId } = req.body;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "editor",
      "set subdomain"
    );

    const subdomainSuffix = getSubdomainSuffix();

    if (subdomain) {
      // Check if the subdomain has the correct suffix
      if (!subdomain.endsWith(subdomainSuffix)) {
        res.json({
          status: "DomainInvalid",
        } satisfies SetSubdomainForProjectResponse);
        return;
      }

      // Check if subdomain is already used by another project
      const existingProjects = await getProjectsUsingDomain(mgr, subdomain);
      if (existingProjects.length > 0 && existingProjects[0].id !== projectId) {
        res.json({
          status: "DomainUsedElsewhereInPlasmic",
        } satisfies SetSubdomainForProjectResponse);
        return;
      }
    }

    // Get current domains and update
    const currentDomains = await mgr.getDomainsForProject(
      projectId as ProjectId
    );
    const { customDomains } = separateDomainsForProject(
      currentDomains,
      subdomainSuffix
    );

    // Build new domain list
    const newDomains = subdomain
      ? [subdomain, ...customDomains]
      : customDomains;

    // Update all domains at once
    await mgr.setDomainsForProject(newDomains, projectId as ProjectId);

    res.json({
      status: "DomainUpdated" as SetDomainStatus,
    } satisfies SetSubdomainForProjectResponse);
  } catch (error: any) {
    console.error("Set subdomain error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to set subdomain" });
    }
  }
}

// PUT /api/v1/custom-domain-for-project
export async function setCustomDomainForProject(
  req: Request,
  res: Response
): Promise<void> {
  const { customDomain, projectId } = req.body;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "editor",
      "set custom domain"
    );

    // Get current domains
    const currentDomains = await mgr.getDomainsForProject(
      projectId as ProjectId
    );
    const subdomainSuffix = getSubdomainSuffix();
    const { subdomain, customDomains: existingCustomDomains } =
      separateDomainsForProject(currentDomains, subdomainSuffix);

    let status: Record<string, SetDomainStatus> = {};
    let newCustomDomains = [...existingCustomDomains];

    if (customDomain) {
      // Validate domain
      const validator = PLASMIC_HOSTING_DOMAIN_VALIDATOR;

      // Basic validation
      if (!validator.isValidDomain(customDomain)) {
        status[customDomain] = "DomainInvalid";
        res.json({ status } satisfies SetCustomDomainForProjectResponse);
        return;
      }

      // Check if it's accidentally a subdomain
      if (customDomain.endsWith(subdomainSuffix)) {
        status[customDomain] = "DomainInvalid";
        res.json({ status } satisfies SetCustomDomainForProjectResponse);
        return;
      }

      // Check if already used elsewhere
      const existingProjects = await getProjectsUsingDomain(mgr, customDomain);
      if (existingProjects.length > 0 && existingProjects[0].id !== projectId) {
        status[customDomain] = "DomainUsedElsewhereInPlasmic";
        res.json({ status } satisfies SetCustomDomainForProjectResponse);
        return;
      }

      // Add to domains list if not already there
      if (!newCustomDomains.includes(customDomain)) {
        newCustomDomains.push(customDomain);
      }

      // Handle www subdomain automatically
      const isApexDomain = !customDomain.startsWith("www.");
      const wwwDomain = isApexDomain
        ? `www.${customDomain}`
        : customDomain.replace("www.", "");

      // Add both apex and www domains
      if (isApexDomain && !newCustomDomains.includes(wwwDomain)) {
        newCustomDomains.push(wwwDomain);
        status[wwwDomain] = "DomainUpdated";
      }

      status[customDomain] = "DomainUpdated";
    } else {
      // Remove all custom domains if customDomain is null/undefined
      newCustomDomains = [];
    }

    // Build final domain list
    const finalDomains = subdomain
      ? [subdomain, ...newCustomDomains]
      : newCustomDomains;

    // Update domains
    await mgr.setDomainsForProject(finalDomains, projectId as ProjectId);

    res.json({ status } satisfies SetCustomDomainForProjectResponse);
  } catch (error: any) {
    console.error("Set custom domain error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to set custom domain" });
    }
  }
}

export async function getPlasmicHostingSettings(
  req: Request,
  res: Response
): Promise<void> {
  const { projectId } = req.params;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "viewer",
      "get hosting settings"
    );

    // Get settings from project metadata or database
    // For now, return empty settings as we don't have a KV store implemented
    // TODO: Implement proper settings storage
    const settings = null;

    if (!settings) {
      // Return empty settings if none exist
      res.json({} satisfies PlasmicHostingSettings);
      return;
    }

    // Parse and return settings
    const parsedSettings = JSON.parse(settings) as PlasmicHostingSettings;
    res.json(parsedSettings);
  } catch (error: any) {
    console.error("Get hosting settings error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to get hosting settings" });
    }
  }
}

export async function updatePlasmicHostingSettings(
  req: Request,
  res: Response
): Promise<void> {
  const { projectId } = req.params;
  const settings = req.body as PlasmicHostingSettings;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "editor",
      "update hosting settings"
    );

    // Validate settings
    if (settings.favicon) {
      if (!settings.favicon.url) {
        res.status(400).json({ error: "Favicon URL is required" });
        return;
      }

      // Basic URL validation
      try {
        new URL(settings.favicon.url);
      } catch (e) {
        res.status(400).json({ error: "Invalid favicon URL" });
        return;
      }
    }

    // Save settings to project metadata or database
    // TODO: Implement proper settings storage
    // For now, just log the settings
    console.log(
      `Would save hosting settings for project ${projectId}:`,
      settings
    );

    res.json(settings);
  } catch (error: any) {
    console.error("Update hosting settings error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to update hosting settings" });
    }
  }
}

export async function revalidateHosting(
  req: Request,
  res: Response
): Promise<void> {
  const { projectId } = req.body as RevalidatePlasmicHostingRequest;
  const mgr = userDbMgr(req);

  try {
    // Check permissions
    await mgr.checkProjectPerms(
      projectId as ProjectId,
      "editor",
      "revalidate hosting"
    );

    // Get all domains for the project
    const domains = await mgr.getDomainsForProject(projectId as ProjectId);

    logger().info(`Revalidating domains: ${domains}`);
    logger().info(`Project ID: ${projectId}`);

    if (domains.length === 0) {
      res.json({
        successes: [],
        failures: [],
      } satisfies RevalidatePlasmicHostingResponse);
      return;
    }

    // Trigger real deployment
    try {
      const deploymentResult = await deployProjectToHosting(
        mgr,
        projectId,
        domains
      );

      // Convert deployment results to expected format
      const successes = deploymentResult.successfulDomains;
      const failures = deploymentResult.failedDomains.map((f) => ({
        domain: f.domain,
        error: {
          type: "Unknown error" as const,
          message: f.error?.message || "Deployment failed",
        },
      }));

      res.json({
        successes,
        failures,
      } satisfies RevalidatePlasmicHostingResponse);
    } catch (deployError: any) {
      // If the entire deployment fails, mark all domains as failed
      const failures = domains.map((domain) => ({
        domain,
        error: {
          type: "Unknown error" as const,
          message: deployError.message || "Deployment failed",
        },
      }));

      res.json({
        successes: [],
        failures,
      } satisfies RevalidatePlasmicHostingResponse);
    }
  } catch (error: any) {
    console.error("Revalidate hosting error:", error);
    if (error.message?.includes("permission")) {
      res.status(403).json({ error: "Access denied" });
    } else {
      res.status(500).json({ error: "Failed to revalidate hosting" });
    }
  }
}
