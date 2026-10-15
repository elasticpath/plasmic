import React from "react";

export function ChooseFieldPrompt(props: {
  propName: string;
  componentName: string;
  className?: string;
}) {
  const { propName, componentName, className } = props;
  return (
    <div className={className} data-ep-choose-field="">
      Choose a field: set "{propName}" on this {componentName}.
    </div>
  );
}
