import {
  DataProvider,
  useSelector,
  usePlasmicCanvasContext,
} from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React, { useMemo } from "react";
import { Registerable } from "../../registerable";
import { useBundleConfiguration } from "../use-bundle-configuration";
import { useBundleOptionProducts } from "../use-bundle-option-products";
import { useParentProducts } from "../use-parent-products";
import {
  useBundleForm as useBundleFormHook,
  useApiFormattedSelections,
} from "../hooks/useBundleForm";
import { useBundleFormSync } from "../hooks/useBundleFormSync";
import { useBundleConfigurationOrchestration } from "../hooks/useBundleConfigurationOrchestration";
import {
  validateBundleProduct,
  getBundlePricingType,
} from "../utils/productValidation";
import { calculateBundlePrice } from "../utils/priceCalculation";
import { ElasticPathBundleProduct } from "../types";
import { Product } from "../../types/product";
import { BundleFormContext, BundleFormContextValue } from "./BundleContext";
import { MOCK_BUNDLE_DATA, MockBundleData } from "./design-time-data";

type PreviewState = "auto" | "withData" | "empty" | "loading" | "error";

interface EPBundleProviderProps {
  children?: React.ReactNode;
  className?: string;
  defaultConfiguration?: string;
  updateUrlOnChange?: boolean;
  debounceMs?: number;
  previewState?: PreviewState;
  loadingContent?: React.ReactNode;
  errorContent?: React.ReactNode;
  notBundleContent?: React.ReactNode;
}

export const epBundleProviderMeta: ComponentMeta<EPBundleProviderProps> = {
  name: "plasmic-commerce-ep-bundle-provider",
  displayName: "EP Bundle Provider",
  description:
    "Root provider for composable bundle configuration. Reads the current product, validates it is a bundle, and exposes bundle state to child components via the bundleData data key.",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "component",
          name: "plasmic-commerce-ep-bundle-component-list",
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-bundle-price-field",
        },
        {
          type: "component",
          name: "plasmic-commerce-ep-bundle-validation-errors",
        },
      ],
    },
    loadingContent: {
      type: "slot",
      displayName: "Loading Content",
      defaultValue: { type: "text", value: "Loading bundle..." },
    },
    errorContent: {
      type: "slot",
      displayName: "Error Content",
      defaultValue: { type: "text", value: "Failed to load bundle" },
    },
    notBundleContent: {
      type: "slot",
      displayName: "Not Bundle Content",
      hidePlaceholder: true,
    },
    defaultConfiguration: {
      type: "string",
      description: "Pre-configured bundle selections (base64 encoded JSON)",
      advanced: true,
    },
    updateUrlOnChange: {
      type: "boolean",
      description: "Update the URL query parameter when configuration changes",
      defaultValue: true,
    },
    debounceMs: {
      type: "number",
      description: "Debounce time for API calls in milliseconds",
      defaultValue: 500,
      advanced: true,
    },
    previewState: {
      type: "choice",
      options: ["auto", "withData", "empty", "loading", "error"],
      defaultValue: "auto",
      displayName: "Preview State",
      description:
        "Force a preview state with sample data for design-time editing",
      advanced: true,
    },
  },
  importPath: "@elasticpath/plasmic-ep-commerce-elastic-path",
  importName: "EPBundleProvider",
  providesData: true,
};

export function EPBundleProvider(props: EPBundleProviderProps) {
  const {
    children,
    className,
    defaultConfiguration,
    updateUrlOnChange,
    debounceMs = 500,
    previewState = "auto",
    loadingContent,
    errorContent,
    notBundleContent,
  } = props;

  const normalizedProduct = useSelector("currentProduct") as
    | Product
    | undefined;
  const inEditor = !!usePlasmicCanvasContext();

  // --- Design-time preview handling ---
  const useMock =
    previewState === "withData" ||
    (previewState === "auto" && !normalizedProduct && inEditor);

  if (inEditor) {
    if (previewState === "loading") {
      return (
        <div className={className} data-ep-bundle-provider="">
          {loadingContent}
        </div>
      );
    }
    if (previewState === "error") {
      return (
        <div className={className} data-ep-bundle-provider="">
          {errorContent}
        </div>
      );
    }
    if (previewState === "empty") {
      return (
        <div className={className} data-ep-bundle-provider="">
          {notBundleContent}
        </div>
      );
    }
  }

  if (useMock) {
    return (
      <DataProvider name="bundleData" data={MOCK_BUNDLE_DATA}>
        <BundleFormContext.Provider value={MOCK_FORM_CONTEXT}>
          <div className={className} data-ep-bundle-provider="">
            {children}
          </div>
        </BundleFormContext.Provider>
      </DataProvider>
    );
  }

  // --- Runtime: real data ---
  return (
    <EPBundleProviderInner
      normalizedProduct={normalizedProduct}
      defaultConfiguration={defaultConfiguration}
      updateUrlOnChange={updateUrlOnChange}
      debounceMs={debounceMs}
      className={className}
      notBundleContent={notBundleContent}
    >
      {children}
    </EPBundleProviderInner>
  );
}

// Extracted inner component to avoid calling hooks conditionally (the preview
// branches above return early, which would violate rules-of-hooks).
// All hooks are called unconditionally here; the early return for invalid
// products happens AFTER all hooks to satisfy React's rules-of-hooks.
function EPBundleProviderInner({
  normalizedProduct,
  defaultConfiguration,
  updateUrlOnChange,
  debounceMs,
  className,
  notBundleContent,
  children,
}: {
  normalizedProduct?: Product;
  defaultConfiguration?: string;
  updateUrlOnChange?: boolean;
  debounceMs: number;
  className?: string;
  notBundleContent?: React.ReactNode;
  children?: React.ReactNode;
}) {
  // Validate product is a bundle — extract with safe defaults so hooks
  // below are always called (rules-of-hooks compliance).
  const productValidation = validateBundleProduct(normalizedProduct);
  const isProductValid = productValidation.isValid;
  const bundleProduct = productValidation.bundleProduct;
  const components = productValidation.components;
  const { isFixedPrice, pricingType } = getBundlePricingType(bundleProduct);

  // --- All hooks called unconditionally below ---

  // Bundle form management with Zod validation
  const {
    form,
    selectedOptions,
    isValid,
    errors,
    handleComponentSelection,
  } = useBundleFormHook({
    components,
    bundleProduct,
    defaultConfiguration,
  });

  // API-formatted selections for backend calls
  const apiFormattedSelections = useApiFormattedSelections(selectedOptions);

  // Bundle configuration API wrapper
  const { configureBundleSelection, configuredBundle } =
    useBundleConfiguration({
      bundleId: bundleProduct?.id || "",
    });

  // Debounced orchestration — disabled when product is not valid
  const { isConfiguring, error: configError } =
    useBundleConfigurationOrchestration({
      selectedOptions: apiFormattedSelections,
      isInitialized: isProductValid,
      isValid,
      bundleProduct,
      configureBundleSelection,
      debounceMs,
    });

  // Form and URL synchronization — disabled when product is not valid
  useBundleFormSync({
    selectedOptions,
    updateUrlOnChange,
    isInitialized: isProductValid,
    form,
    configuredBundle,
  });

  // Fetch parent products and option product metadata
  const { parentProducts } = useParentProducts({
    components,
    enabled: productValidation.isBundle,
  });

  const { products: optionProducts, loading: productsLoading } =
    useBundleOptionProducts({
      components,
      parentProducts,
      enabled: productValidation.isBundle,
    });

  // Pricing
  const priceInfo = calculateBundlePrice(
    bundleProduct,
    configuredBundle ? { data: configuredBundle.data as ElasticPathBundleProduct | undefined } : undefined
  );

  // Validation errors as string array
  const validationErrors = useMemo(
    () => Object.values(errors),
    [errors]
  );
  const allErrors = useMemo(() => {
    const errs = [...validationErrors];
    if (configError) {
      errs.push(configError.message);
    }
    return errs;
  }, [validationErrors, configError]);

  // bundleData shape per spec
  const bundleData: MockBundleData = useMemo(
    () => ({
      isValid,
      errors: allErrors,
      pricingType,
      currentPrice: priceInfo.currentPrice ?? "",
      isConfiguring,
      componentCount: Object.keys(components).length,
    }),
    [isValid, allErrors, pricingType, priceInfo.currentPrice, isConfiguring, components]
  );

  // Form context for imperative actions
  const formContextValue: BundleFormContextValue = useMemo(
    () => ({
      handleComponentSelection,
      selectedOptions,
      components,
      parentProducts,
      optionProducts,
      productsLoading,
      isFixedPrice,
    }),
    [
      handleComponentSelection,
      selectedOptions,
      components,
      parentProducts,
      optionProducts,
      productsLoading,
      isFixedPrice,
    ]
  );

  // --- Early return AFTER all hooks (rules-of-hooks compliant) ---
  if (!isProductValid) {
    if (notBundleContent) {
      return (
        <div className={className} data-ep-bundle-provider="">
          {notBundleContent}
        </div>
      );
    }
    return null;
  }

  return (
    <DataProvider name="bundleData" data={bundleData}>
      <BundleFormContext.Provider value={formContextValue}>
        <div className={className} data-ep-bundle-provider="">
          {children}
        </div>
      </BundleFormContext.Provider>
    </DataProvider>
  );
}

// Mock form context for design-time — actions are no-ops
const MOCK_FORM_CONTEXT: BundleFormContextValue = {
  handleComponentSelection: () => {},
  selectedOptions: {
    processor: { "opt-proc-1": 1 },
    memory: { "opt-mem-1": 1 },
    storage: { "opt-stor-1": 1 },
  },
  components: {},
  parentProducts: {},
  optionProducts: {},
  productsLoading: false,
  isFixedPrice: false,
};

export function registerEPBundleProvider(
  loader?: Registerable,
  customMeta?: ComponentMeta<EPBundleProviderProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(EPBundleProvider, customMeta ?? epBundleProviderMeta);
}
