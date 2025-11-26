import React from "react";

interface ValidationErrorsProps {
  errors: string[];
  className?: string;
}

export function ValidationErrors({ errors, className }: ValidationErrorsProps) {
  if (errors.length === 0) {
    return null;
  }

  return (
    <div className={className} style={{ marginBottom: "20px", color: "#d32f2f" }}>
      {errors.map((error, idx) => (
        <div key={idx}>{error}</div>
      ))}
    </div>
  );
}