"use client";

import "@/plasmic-register";
import { registerComponentsInner } from "@/plasmic-register-components";
import { PLASMIC } from "@/plasmic-init";
import { PlasmicRootProvider } from "@plasmicapp/loader-nextjs";
import React from "react";

// Register EP components at module-load time. This file is a "use client"
// boundary, so its module graph (incl. plasmic-register-components.ts +
// the EP main entry) is webpack-bundled into Next's client-component
// pipeline — same React instance Next uses for SSR of client components.
// Registration runs during module load both server-side (when Next SSRs
// the PlasmicClientRootProvider for initial HTML) and client-side (on
// hydration). Idempotent guard inside registerComponentsInner makes the
// repeat call a no-op.
registerComponentsInner(PLASMIC);

export function PlasmicClientRootProvider(
  props: Omit<React.ComponentProps<typeof PlasmicRootProvider>, "loader">
) {
  return (
    <PlasmicRootProvider loader={PLASMIC} {...props}></PlasmicRootProvider>
  );
}
