import { useRRouteMatch } from "@/wab/client/cli-routes";
import {
  useCmsDatabase,
  useMutateDatabase,
} from "@/wab/client/components/cms/cms-contexts";
import { PublicLink } from "@/wab/client/components/PublicLink";
import { useApi, useAppCtx } from "@/wab/client/contexts/AppContexts";
import {
  DefaultCmsTopBarProps,
  PlasmicCmsTopBar,
} from "@/wab/client/plasmic/plasmic_kit_cms/PlasmicCmsTopBar";
import { APP_ROUTES } from "@/wab/shared/route/app-routes";
import { Tooltip } from "antd";
import { HTMLElementRefOf } from "@plasmicapp/react-web";
import * as React from "react";

export type CmsTopBarProps = DefaultCmsTopBarProps;

function CmsTopBar_(props: CmsTopBarProps, ref: HTMLElementRefOf<"div">) {
  const match = useRRouteMatch(APP_ROUTES.cmsRoot)!;
  const database = useCmsDatabase(match?.params.databaseId);
  const api = useApi();
  const appCtx = useAppCtx();
  const mutateDatabase = useMutateDatabase();

  const brand = appCtx.appConfig.brands?.[""];

  return (
    <PlasmicCmsTopBar
      root={{ ref }}
      cmsNameValue={database?.name}
      cmsName={{
        value: database?.name,
        onChange: async (newName) => {
          await api.updateCmsDatabase(database!.id, { name: newName });
          await mutateDatabase(database!.id);
        },
      }}
      link={{
        render: (linkProps) => (
          <Tooltip title={brand?.logoTooltip ?? "Back to dashboard"}>
            <PublicLink
              {...linkProps}
              href={brand?.logoHref ?? "/"}
            >
              {brand?.logoImgSrc ? (
                <img src={brand.logoImgSrc} style={{ maxHeight: 40 }} />
              ) : (
                linkProps.children
              )}
            </PublicLink>
          </Tooltip>
        ),
      }}
      {...props}
    />
  );
}

const CmsTopBar = React.forwardRef(CmsTopBar_);
export default CmsTopBar;
