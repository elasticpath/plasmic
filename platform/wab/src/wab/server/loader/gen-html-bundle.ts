import {
  getCodegenPublicUrl,
  getDataUrl,
  getLoaderInternalUrl,
} from "@/wab/shared/urls";
import {
  extractPlasmicQueryDataFromElement,
  GlobalVariantSpec,
  initPlasmicLoader,
  renderToString,
} from "@plasmicapp/loader-react";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { PageParams } from "./page-params";

export async function genLoaderHtmlBundle(opts: {
  projectId: string;
  component: string;
  projectToken: string;
  version?: string;
  hydrate?: boolean;
  embedHydrate?: boolean;
  prepass?: boolean;
  componentProps?: any;
  globalVariants?: GlobalVariantSpec[];
  pageRoute?: string;
  pageParams?: PageParams;
  pageQuery?: PageParams;
}) {
  const {
    projectId,
    component,
    version,
    hydrate,
    embedHydrate,
    projectToken,
    componentProps,
    globalVariants,
    prepass,
    pageRoute,
    pageParams,
    pageQuery,
  } = opts;

  // Set the data host for data source operations during SSR prepass.
  // This ensures data queries hit the self-hosted integration service
  // instead of the default data.plasmic.app.
  (globalThis as any).__PLASMIC_DATA_HOST = getDataUrl();

  const loader = initPlasmicLoader({
    projects: [
      {
        id: projectId,
        version,
        token: projectToken,
      },
    ],
    preview: !version,
    host: getLoaderInternalUrl(),
  });

  const data = await loader.fetchComponentData({
    name: component,
    projectId,
  });

  const prefetchedQueryData = prepass
    ? await extractPlasmicQueryDataFromElement(
        loader,
        { name: component, projectId },
        {
          prefetchedData: data,
          componentProps,
          globalVariants,
          pageParams,
          pageQuery,
        } as any // Type assertion needed - npm package types don't include pageParams/pageQuery
      )
    : undefined;

  const innerHtml = renderToString(
    loader,
    { name: component, projectId },
    {
      prefetchedData: data,
      componentProps,
      globalVariants,
      prefetchedQueryData,
      pageParams,
      pageQuery,
    } as any // Type assertion needed - npm package types don't include pageParams/pageQuery
  );

  const outerElement = React.createElement(
    React.Fragment,
    {},
    React.createElement("div", {
      "data-plasmic-project-id": projectId,
      "data-plasmic-project-version": version,
      "data-plasmic-component": component,
      "data-plasmic-project-token":
        hydrate && !embedHydrate ? projectToken : "",
      "data-plasmic-component-data":
        hydrate && embedHydrate ? JSON.stringify(data) : "",
      "data-plasmic-component-props": JSON.stringify(componentProps || {}),
      "data-plasmic-global-variants": JSON.stringify(globalVariants || []),
      "data-plasmic-prefetched-query-data":
        hydrate && embedHydrate && prepass
          ? JSON.stringify(prefetchedQueryData || {})
          : "",
      "data-plasmic-page-route": hydrate ? pageRoute || "" : "",
      "data-plasmic-page-params": hydrate
        ? JSON.stringify(pageParams || {})
        : "",
      "data-plasmic-page-query": hydrate
        ? JSON.stringify(pageQuery || {})
        : "",
      dangerouslySetInnerHTML: { __html: innerHtml },
    }),
    hydrate &&
      React.createElement("script", {
        async: true,
        src: `${getCodegenPublicUrl()}/static/js/loader-hydrate.js`,
      })
  );

  const outerHtml = ReactDOMServer.renderToStaticMarkup(outerElement);

  return {
    html: outerHtml,
  };
}

async function main(argv = process.argv) {
  try {
    console.log = () => {};
    console.warn = () => {};
    console.error = () => {};
    console.info = () => {};
    console.debug = () => {};
    const args = JSON.parse(argv[2]);
    const { html } = await genLoaderHtmlBundle(args);
    // Node will wait for the contents to finish writing before exiting, so we don't need to wait on a callback.
    // This is actually safer and simpler than, say, using fs.writeSync(), which does a partial write and requires retrying.
    process.stdout.write(html);
  } catch (e) {
    process.stderr.write("" + e.stack);
    process.exit(1);
  }
}

if (require.main === module) {
  const res = main();
}
