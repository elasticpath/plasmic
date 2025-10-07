import { PageFooter } from "@/wab/client/components/pages/PageFooter";
import { Tooltip } from "antd";
import * as React from "react";
import { ReactNode } from "react";

export function IntakeFlowForm(props: { children: ReactNode }) {
  return (
    <div className={"LoginForm__Container"}>
      <div className={"LoginForm__Content"}>
        <div className={"LoginForm__Logo"}>
          <Tooltip title="Elastic Path">
            <img
              src="https://developer.elasticpath.com/logo/light.svg"
              alt="Elastic Path"
              style={{ width: 128, height: 64 }}
            />
          </Tooltip>
        </div>
        {props.children}
        <PageFooter />
      </div>
    </div>
  );
}
