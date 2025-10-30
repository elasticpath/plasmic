import { unbundleProjectFromData } from "@/wab/server/db/DbBundleLoader";
import { DbMgr } from "@/wab/server/db/DbMgr";
import { genLoaderHtmlBundle } from "@/wab/server/loader/gen-html-bundle";
import { ProjectId } from "@/wab/shared/ApiSchema";
import { Bundler } from "@/wab/shared/bundler";
import { ensure } from "@/wab/shared/common";
import { isPageComponent } from "@/wab/shared/core/components";
import S3 from "aws-sdk/clients/s3";
import { v4 as uuidv4 } from "uuid";

// Configuration
const HOSTING_BUCKET =
  process.env.PLASMIC_HOSTING_BUCKET || "plasmic-hosting-sites";

export interface DeploymentResult {
  deploymentId: string;
  successfulDomains: { domain: string }[];
  failedDomains: { domain: string; error: any }[];
}

export interface PageAsset {
  path: string;
  html: string;
  componentName: string;
}

export interface DeploymentAssets {
  pages: PageAsset[];
  metadata: {
    projectId: string;
    version: string;
    generatedAt: Date;
    favicon?: string;
  };
}

/**
 * Main deployment function - simplified for static content only
 */
export async function deployProjectToHosting(
  mgr: DbMgr,
  projectId: ProjectId,
  domains: string[]
): Promise<DeploymentResult> {
  const deploymentId = uuidv4();
  const successfulDomains: { domain: string }[] = [];
  const failedDomains: { domain: string; error: any }[] = [];

  try {
    // 1. Generate static assets for all pages
    console.log(`Generating static assets for project ${projectId}`);
    const assets = await generateStaticAssets(mgr, projectId);

    // 2. Upload to S3
    console.log(`Uploading assets to S3 for deployment ${deploymentId}`);
    await uploadToS3(assets, projectId, deploymentId);

    // 3. Configure CDN for each domain (simplified - just log for now)
    for (const domain of domains) {
      try {
        console.log(`Configuring CDN for domain ${domain}`);
        await configureCDNForDomain(domain, projectId, deploymentId);
        successfulDomains.push({ domain });
      } catch (error) {
        console.error(`Failed to configure CDN for ${domain}:`, error);
        failedDomains.push({ domain, error });
      }
    }

    // 4. Store deployment record
    await storeDeploymentRecord(mgr, {
      deploymentId,
      projectId,
      domains,
      status: "success",
      createdAt: new Date(),
    });

    return {
      deploymentId,
      successfulDomains,
      failedDomains,
    };
  } catch (error) {
    console.error("Deployment failed:", error);

    await storeDeploymentRecord(mgr, {
      deploymentId,
      projectId,
      domains,
      status: "failed",
      createdAt: new Date(),
      error: error.message,
    });

    throw error;
  }
}

/**
 * Generate static assets for a Plasmic project
 */
async function generateStaticAssets(
  mgr: DbMgr,
  projectId: ProjectId
): Promise<DeploymentAssets> {
  const project = await mgr.getProjectById(projectId);
  const projectToken = ensure(
    project.projectApiToken,
    "Project API token not found"
  );

  // Get latest revision
  const latestRev = await mgr.getLatestProjectRev(projectId);

  // Create a bundler instance
  const bundler = new Bundler();

  // Unbundle the project to get the Site object
  const site = await unbundleProjectFromData(mgr, bundler, latestRev);

  // Extract all pages from the site
  const pages: Array<{ name: string; path: string }> = [];

  for (const component of site.components) {
    if (isPageComponent(component)) {
      const pageMeta = component.pageMeta;
      pages.push({
        name: component.name,
        // Use the page path from pageMeta, or generate from name
        path:
          pageMeta?.path ||
          `/${component.name.toLowerCase().replace(/\s+/g, "-")}`,
      });
    }
  }

  // Ensure we have a homepage
  if (pages.length > 0 && !pages.find((p) => p.path === "/")) {
    const homepage = pages.find(
      (p) =>
        p.name.toLowerCase() === "homepage" ||
        p.name.toLowerCase() === "home" ||
        p.name.toLowerCase() === "index"
    );
    if (homepage) {
      homepage.path = "/";
    } else {
      // If no obvious homepage, use the first page
      pages[0].path = "/";
    }
  }

  console.log(
    `Found ${pages.length} pages in project ${projectId}:`,
    pages.map((p) => `${p.name} (${p.path})`)
  );

  const assets: DeploymentAssets = {
    pages: [],
    metadata: {
      projectId,
      version: `rev-${latestRev.revision}`,
      generatedAt: new Date(),
    },
  };

  // Generate HTML for each page
  for (const page of pages) {
    try {
      const htmlBundle = await genLoaderHtmlBundle({
        projectId,
        component: page.name,
        projectToken,
        hydrate: true,
        embedHydrate: true,
        prepass: true,
      });

      assets.pages.push({
        path: page.path,
        html: htmlBundle,
        componentName: page.name,
      });

      console.log(`Generated HTML for page ${page.name} at ${page.path}`);
    } catch (error) {
      console.error(`Failed to generate HTML for page ${page.name}:`, error);
    }
  }

  return assets;
}

/**
 * Upload deployment assets to S3
 */
async function uploadToS3(
  assets: DeploymentAssets,
  projectId: string,
  deploymentId: string
): Promise<void> {
  const s3 = new S3();
  const prefix = `sites/${projectId}/${deploymentId}`;

  // Upload pages
  for (const page of assets.pages) {
    const key =
      page.path === "/" ? `${prefix}/index.html` : `${prefix}${page.path}.html`;

    await s3
      .putObject({
        Bucket: HOSTING_BUCKET,
        Key: key,
        Body: page.html,
        ContentType: "text/html; charset=utf-8",
        CacheControl: "public, max-age=3600", // 1 hour cache for HTML
      })
      .promise();
  }

  // Upload deployment manifest
  await s3
    .putObject({
      Bucket: HOSTING_BUCKET,
      Key: `${prefix}/_plasmic/manifest.json`,
      Body: JSON.stringify({
        ...assets.metadata,
        deploymentId,
        pages: assets.pages.map((p) => ({
          path: p.path,
          component: p.componentName,
        })),
      }),
      ContentType: "application/json",
      CacheControl: "public, max-age=300", // 5 minutes
    })
    .promise();
}

/**
 * Configure CDN for a domain (simplified for now)
 */
async function configureCDNForDomain(
  domain: string,
  projectId: string,
  deploymentId: string
): Promise<void> {
  // For now, just log what would be done
  console.log(`Configuring CDN for ${domain}:`);
  console.log(
    `  - S3 Origin: ${HOSTING_BUCKET}/sites/${projectId}/${deploymentId}`
  );
  console.log(`  - Domain alias: ${domain}`);

  // For plasmic.run subdomains, we can automate DNS
  if (domain.endsWith(".plasmic.run")) {
    console.log(`  - Would configure DNS for plasmic.run subdomain`);
  }
}

/**
 * Store deployment record in database
 */
async function storeDeploymentRecord(
  mgr: DbMgr,
  record: {
    deploymentId: string;
    projectId: string;
    domains: string[];
    status: "pending" | "success" | "failed";
    createdAt: Date;
    error?: string;
  }
): Promise<void> {
  // TODO: Store deployment history
  // For now, just log
  console.log("Deployment record:", record);
}

/**
 * Check DNS configuration for a domain (simplified for now)
 */
export async function checkDnsConfiguration(domain: string): Promise<boolean> {
  // TODO: Implement actual DNS checking
  console.log(`DNS check requested for domain: ${domain}`);

  // For now, return true for plasmic.run domains
  if (domain.endsWith(".plasmic.run")) {
    return true;
  }

  return false;
}
