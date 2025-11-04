import React from "react";

interface BundlePriceProps {
  currentPrice?: string;
  isConfiguring: boolean;
  isFixedPrice: boolean;
  className?: string;
}

export function BundlePrice({ 
  currentPrice, 
  isConfiguring, 
  isFixedPrice,
  className 
}: BundlePriceProps) {
  return (
    <div className={className} style={{ marginBottom: "20px", fontSize: "1.2em", fontWeight: "bold" }}>
      <div>
        Price: {isConfiguring ? "Updating..." : currentPrice || "N/A"}
      </div>
      <div style={{ fontSize: "0.8em", fontWeight: "normal", color: "#666" }}>
        {isFixedPrice ? "Fixed Price Bundle" : "Cumulative Price Bundle"}
      </div>
    </div>
  );
}