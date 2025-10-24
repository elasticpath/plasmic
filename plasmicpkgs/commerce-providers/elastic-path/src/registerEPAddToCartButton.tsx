import { useSelector } from "@plasmicapp/host";
import registerComponent, {
  ComponentMeta,
} from "@plasmicapp/host/registerComponent";
import React from "react";
import { useFormContext } from "react-hook-form";
import { useAddItem, CommerceError, Product } from "@plasmicpkgs/commerce";
import { Registerable } from "./registerable";

interface EPAddToCartButtonProps {
  children?: React.ReactNode;
}

export const epAddToCartButtonMeta: ComponentMeta<EPAddToCartButtonProps> = {
  name: "plasmic-commerce-ep-add-to-cart-button",
  displayName: "EP Add To Cart Button",
  description: "Elastic Path specific add to cart button with bundle support",
  props: {
    children: {
      type: "slot",
      defaultValue: [
        {
          type: "button",
          value: "Add To Cart",
        },
      ],
    },
  },
  importPath: "@plasmicpkgs/commerce",
  importName: "EPAddToCartButton",
};

export function EPAddToCartButton(props: EPAddToCartButtonProps) {
  const { children } = props;

  const product = useSelector("currentProduct") as Product | undefined;
  const form = useFormContext();
  const addItem = useAddItem();

  const addToCart = async () => {
    const quantity = +(form.getValues()["ProductQuantity"] ?? 1);
    if (isNaN(quantity) || quantity < 1) {
      throw new CommerceError({
        message: "The item quantity has to be a valid integer greater than 0",
      });
    }
    if (product) {
      const variantId =
        form.getValues()["ProductVariant"] ?? product.variants[0].id;
      const bundleConfiguration = form.getValues()["BundleConfiguration"];
      
      await addItem({
        productId: product.id,
        variantId: variantId,
        quantity: quantity,
        ...(bundleConfiguration && { bundleConfiguration }),
      });
    }
  };

  return React.isValidElement(children)
    ? React.cloneElement(children, {
        onClick: (e: MouseEvent) => {
          if (
            children.props.onClick &&
            typeof children.props.onClick === "function"
          ) {
            children.props.onClick(e);
          }
          addToCart();
        },
      } as Partial<unknown> & React.Attributes)
    : null;
}

export function registerEPAddToCartButton(
  loader?: Registerable,
  customEPAddToCartButtonMeta?: ComponentMeta<EPAddToCartButtonProps>
) {
  const doRegisterComponent: typeof registerComponent = (...args) =>
    loader ? loader.registerComponent(...args) : registerComponent(...args);
  doRegisterComponent(
    EPAddToCartButton,
    customEPAddToCartButtonMeta ?? epAddToCartButtonMeta
  );
}