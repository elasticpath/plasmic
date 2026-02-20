import * as React from "react";
import { Helmet } from "react-helmet";

export function documentTitle(title: string) {
  return (
    // @ts-ignore
    <Helmet>
      <title>{title ? `${title} - Visual Builder` : `Visual Builder`}</title>
    </Helmet>
  );
}
