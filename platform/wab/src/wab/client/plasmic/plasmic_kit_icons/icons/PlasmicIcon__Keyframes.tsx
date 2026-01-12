/* eslint-disable */
/* tslint:disable */
// @ts-nocheck
/* prettier-ignore-start */
import { classNames } from "@plasmicapp/react-web";
import React from "react";

export type KeyframesIconProps = React.ComponentProps<"svg"> & {
  title?: string;
};

export function KeyframesIcon(props: KeyframesIconProps) {
  const { className, style, title, ...restProps } = props;
  return (
    <svg
      xmlns={"http://www.w3.org/2000/svg"}
      xmlnsXlink={"http://www.w3.org/1999/xlink"}
      fill={"none"}
      viewBox={"0 0 24 24"}
      height={"1em"}
      className={classNames("plasmic-default__svg", className)}
      style={style}
      {...restProps}
    >
      {title && <title>{title}</title>}

      <g
        stroke={"currentcolor"}
        strokeLinecap={"round"}
        strokeLinejoin={"round"}
        strokeWidth={"1.5"}
        clipPath={"url(#a)"}
      >
        <path
          d={
            "M9.225 18.412A1.6 1.6 0 0 1 8 19c-.468 0-.914-.214-1.225-.588l-4.361-5.248a1.844 1.844 0 0 1 0-2.328l4.36-5.248A1.6 1.6 0 0 1 8 5c.468 0 .914.214 1.225.588l4.36 5.248a1.844 1.844 0 0 1 0 2.328zM17 5l4.586 5.836a1.844 1.844 0 0 1 0 2.328L17 19"
          }
        ></path>

        <path d={"m13 5 4.586 5.836a1.844 1.844 0 0 1 0 2.328L13 19"}></path>
      </g>

      <defs>
        <clipPath id={"a"}>
          <path fill={"#fff"} d={"M0 0h24v24H0z"}></path>
        </clipPath>
      </defs>
    </svg>
  );
}

export default KeyframesIcon;
/* prettier-ignore-end */
