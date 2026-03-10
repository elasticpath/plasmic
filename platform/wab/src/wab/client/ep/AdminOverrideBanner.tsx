import React from "react";
import { clearOverrideCookie, hasOverrideCookie } from "./dashboard-restriction";

const bannerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  padding: "6px 12px",
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 13,
  fontWeight: 500,
  zIndex: 9999,
};

const buttonStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid #92400e",
  borderRadius: 4,
  color: "#92400e",
  cursor: "pointer",
  fontSize: 12,
  padding: "2px 8px",
};

export function AdminOverrideBanner() {
  if (!hasOverrideCookie()) {
    return null;
  }
  return (
    <div style={bannerStyle}>
      Admin dashboard override active
      <button
        style={buttonStyle}
        onClick={() => {
          clearOverrideCookie();
          window.location.reload();
        }}
      >
        Remove
      </button>
    </div>
  );
}
