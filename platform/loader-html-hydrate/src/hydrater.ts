import {
  hydrateFromElement,
  initPlasmicLoader,
} from "@plasmicapp/loader-react";

export class PlasmicHtmlHydrater {
  async hydrateElement(element: HTMLElement) {
    const projectId = element.getAttribute("data-plasmic-project-id");
    const version = element.getAttribute("data-plasmic-project-version");
    const component = element.getAttribute("data-plasmic-component");
    const token = element.getAttribute("data-plasmic-project-token");
    const componentDataString = element.getAttribute(
      "data-plasmic-component-data"
    );

    const noData = !(token || componentDataString);
    if (!(projectId && component) || noData) {
      return;
    }

    const componentProps = JSON.parse(
      element.getAttribute("data-plasmic-component-props") || "{}"
    );
    const globalVariants = JSON.parse(
      element.getAttribute("data-plasmic-global-variants") || "[]"
    );

    const prefetchedQueryData = JSON.parse(
      element.getAttribute("data-plasmic-prefetched-query-data") || "{}"
    );

    // Read page params data attributes for dynamic route support.
    // Note: pageRoute is read but not passed to hydrateFromElement because
    // the loader-react package doesn't support it in the hydration flow.
    // This means $ctx.params and $ctx.query will work, but $ctx.pageRoute
    // and $ctx.pagePath won't be available after hydration.
    const _pageRoute =
      element.getAttribute("data-plasmic-page-route") || undefined;
    const pageParams = JSON.parse(
      element.getAttribute("data-plasmic-page-params") || "{}"
    );
    const pageQuery = JSON.parse(
      element.getAttribute("data-plasmic-page-query") || "{}"
    );

    const loader = initPlasmicLoader({
      projects: [
        {
          id: projectId,
          version: version ?? undefined,
          token: token ?? "",
        },
      ],
    });

    element.setAttribute("data-plasmic-hydrating", "true");
    const data = componentDataString
      ? JSON.parse(componentDataString)
      : await loader.fetchComponentData({ name: component, projectId });
    await hydrateFromElement(
      loader,
      element,
      { name: component, projectId },
      {
        prefetchedData: data,
        globalVariants,
        componentProps,
        prefetchedQueryData,
        // Pass page params if present (for dynamic route support)
        ...(Object.keys(pageParams).length > 0 && { pageParams }),
        ...(Object.keys(pageQuery).length > 0 && { pageQuery }),
      } as any // Type assertion needed - npm package types don't include pageParams/pageQuery
    );
    element.setAttribute("data-plasmic-hydrating", "false");
    element.setAttribute("data-plasmic-hydrated", "true");
  }

  async hydrateAll() {
    const elements = Array.from(
      document.querySelectorAll(`[data-plasmic-component]`)
    ).filter(
      (elt) =>
        !elt.getAttribute("data-plasmic-hydrating") &&
        !elt.getAttribute("data-plasmic-hydrated")
    );

    return await Promise.all(
      elements.map((elt) => this.hydrateElement(elt as HTMLElement))
    );
  }
}
