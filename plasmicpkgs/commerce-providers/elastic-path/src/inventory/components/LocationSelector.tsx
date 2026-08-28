import React from "react";
import type { LocationSelectorProps } from "../types";

export function LocationSelector({
  locations,
  selectedLocationId,
  onLocationChange,
  loading = false,
  placeholder = "Select a location",
}: LocationSelectorProps) {
  if (loading) {
    return (
      <div style={{ padding: "8px 12px", color: "#666", fontSize: "0.875rem" }}>
        Loading locations...
      </div>
    );
  }

  if (locations.length === 0) {
    return (
      <div style={{ padding: "8px 12px", color: "#666", fontSize: "0.875rem" }}>
        No locations available
      </div>
    );
  }

  return (
    <select
      value={selectedLocationId || ""}
      onChange={(e) => onLocationChange(e.target.value)}
      style={{
        padding: "8px 12px",
        border: "1px solid #ddd",
        borderRadius: "4px",
        fontSize: "0.875rem",
        backgroundColor: "#fff",
        cursor: "pointer",
        minWidth: "200px",
      }}
    >
      <option value="" disabled>
        {placeholder}
      </option>
      {locations.map((location) => (
        <option key={location.id} value={location.id}>
          {location.attributes?.name || `Location ${location.id}`}
        </option>
      ))}
    </select>
  );
}