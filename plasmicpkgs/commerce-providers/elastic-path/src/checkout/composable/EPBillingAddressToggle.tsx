import {
  DataProvider,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useState } from "react";
import { Registerable } from "../../registerable";

interface EPBillingAddressToggleProps {
  className?: string;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  label?: string;
  billingContent?: React.ReactNode;
  previewState?: "auto" | "same" | "different";
}

export const epBillingAddressToggleMeta: ComponentMeta<EPBillingAddressToggleProps> =
  {
    name: "plasmic-commerce-ep-billing-address-toggle",
    displayName: "EP Billing Address Toggle",
    description:
      '"Billing address same as shipping" checkbox with conditional billing address form slot.',
    props: {
      checked: {
        type: "boolean",
        defaultValue: true,
        displayName: "Same as Shipping",
      },
      onChange: {
        type: "eventHandler" as const,
        argTypes: [{ name: "checked", type: "boolean" }],
      },
      label: {
        type: "string",
        defaultValue: "Billing address same as shipping",
        displayName: "Label",
      },
      billingContent: {
        type: "slot",
        displayName: "Billing Address Form",
        hidePlaceholder: true,
      },
      previewState: {
        type: "choice",
        options: ["auto", "same", "different"],
        defaultValue: "auto",
        displayName: "Preview State",
        description:
          "Force a preview state for design-time editing",
        advanced: true,
      },
    },
    importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
    importName: "EPBillingAddressToggle",
    providesData: true,
  };

export function EPBillingAddressToggle(props: EPBillingAddressToggleProps) {
  const {
    className,
    checked: checkedProp = true,
    onChange,
    label = "Billing address same as shipping",
    billingContent,
    previewState = "auto",
  } = props;

  const inEditor = !!usePlasmicCanvasContext();

  const [internalChecked, setInternalChecked] = useState(true);
  const checked = checkedProp ?? internalChecked;

  // In editor with forced preview state
  const effectiveChecked =
    inEditor && previewState !== "auto"
      ? previewState === "same"
      : checked;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = e.target.checked;
    setInternalChecked(next);
    onChange?.(next);
  };

  const toggleData = {
    isSameAsShipping: effectiveChecked,
  };

  return (
    <DataProvider name="billingToggleData" data={toggleData}>
      <div className={className} data-ep-billing-toggle="">
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={effectiveChecked}
            onChange={handleChange}
          />
          <span>{label}</span>
        </label>
        {!effectiveChecked && billingContent}
      </div>
    </DataProvider>
  );
}

export function registerEPBillingAddressToggle(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBillingAddressToggleProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPBillingAddressToggle,
    customMeta ?? epBillingAddressToggleMeta
  );
}
