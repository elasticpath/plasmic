"use client";

import { PLASMIC } from "@/plasmic-init";
import { PlasmicRootProvider } from "@plasmicapp/loader-nextjs";
import React from "react";

// Register the storefront's own code components here; see
// https://docs.plasmic.app/learn/code-components-ref/
// The Elastic Path components are NOT registered anywhere in this app — they
// arrive in the loader bundle from the `commerce-elastic-path` hostless
// package installed in the Plasmic project.
//
// PLASMIC.registerComponent(...);

export function PlasmicClientRootProvider(
  props: Omit<React.ComponentProps<typeof PlasmicRootProvider>, "loader">
) {
  return <PlasmicRootProvider loader={PLASMIC} {...props} />;
}
