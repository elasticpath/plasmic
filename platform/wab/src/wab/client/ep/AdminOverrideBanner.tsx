import React from "react";
import { clearOverrideCookie, hasOverrideCookie } from "./dashboard-restriction";

const bannerStyle: React.CSSProperties = {
  position: "fixed",
  bottom: 8,
  right: 8,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "3px 10px",
  background: "#fef3c7",
  color: "#92400e",
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 4,
  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
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
