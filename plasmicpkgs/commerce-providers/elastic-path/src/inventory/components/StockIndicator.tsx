import React from "react";
import { DEFAULT_LOW_STOCK_THRESHOLD, DEFAULT_MEDIUM_STOCK_THRESHOLD } from "../../const";
import type { StockIndicatorProps } from "../types";

export function StockIndicator({
  stock,
  threshold = { low: DEFAULT_LOW_STOCK_THRESHOLD, medium: DEFAULT_MEDIUM_STOCK_THRESHOLD },
  showExact = true,
}: StockIndicatorProps) {
  const getStockLevel = () => {
    if (stock <= 0) return "out";
    if (stock <= threshold.low) return "low";
    if (stock <= threshold.medium) return "medium";
    return "high";
  };

  const getStockMessage = () => {
    const level = getStockLevel();
    
    if (level === "out") return "Out of stock";
    if (level === "low") return showExact ? `Only ${stock} left` : "Low stock";
    if (level === "medium") return showExact ? `${stock} in stock` : "In stock";
    return showExact ? `${stock} in stock` : "In stock";
  };

  const getStockColor = () => {
    const level = getStockLevel();
    switch (level) {
      case "out": return "#d32f2f";
      case "low": return "#f57c00";
      case "medium": return "#1976d2";
      case "high": return "#388e3c";
      default: return "#666";
    }
  };

  const getStockIcon = () => {
    const level = getStockLevel();
    switch (level) {
      case "out": return "❌";
      case "low": return "⚠️";
      case "medium": return "📦";
      case "high": return "✅";
      default: return "📦";
    }
  };

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={getStockMessage()}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        color: getStockColor(),
        fontSize: "0.875rem",
        fontWeight: stock <= threshold.low ? "600" : "400",
      }}
    >
      <span aria-hidden="true">{getStockIcon()}</span>
      <span>{getStockMessage()}</span>
    </span>
  );
}