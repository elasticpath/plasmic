import React, { useState, useEffect } from "react";
import { useFormContext } from "react-hook-form";
import { useProductStock } from "../use-stock";
import { useLocations } from "../use-locations";
import { StockIndicator } from "./StockIndicator";
import { LocationSelector } from "./LocationSelector";
import type { MultiLocationStockProps } from "../types";

export function MultiLocationStock({
  productId,
  showLocationSelector = true,
  maxLocationsDisplay = 5,
  showStockNumbers = true,
  lowStockThreshold = 5,
}: MultiLocationStockProps) {
  const [selectedLocationId, setSelectedLocationId] = useState<string>("");
  const form = useFormContext();
  
  const { locations, loading: locationsLoading } = useLocations();
  
  // Update form context when location changes to pass slug to add to cart
  useEffect(() => {
    console.log("MultiLocationStock - form available:", !!form);
    console.log("MultiLocationStock - selectedLocationId:", selectedLocationId);
    console.log("MultiLocationStock - locations:", locations);
    
    if (selectedLocationId && form) {
      const selectedLocation = locations.find(loc => loc.id === selectedLocationId);
      const locationSlug = (selectedLocation?.attributes as any)?.slug || selectedLocationId;
      console.log("MultiLocationStock - setting location slug:", locationSlug);
      form.setValue("SelectedLocationSlug", locationSlug);
    } else if (form) {
      console.log("MultiLocationStock - clearing location slug");
      form.setValue("SelectedLocationSlug", undefined);
    }
  }, [selectedLocationId, locations, form]);
  const { stock, loading: stockLoading, error } = useProductStock(
    productId || "",
    undefined, // Don't filter by location in the API call - get all locations
    !!productId
  );

  if (!productId) {
    return (
      <div style={{ padding: "12px", color: "#666", fontSize: "0.875rem" }}>
        No product selected
      </div>
    );
  }

  if (stockLoading || locationsLoading) {
    return (
      <div style={{ padding: "12px", color: "#666", fontSize: "0.875rem" }}>
        Loading stock information...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "12px", color: "#d32f2f", fontSize: "0.875rem" }}>
        Error loading stock: {error.message}
      </div>
    );
  }

  if (!stock || stock.locations.length === 0) {
    return (
      <div style={{ padding: "12px", color: "#666", fontSize: "0.875rem" }}>
        No stock information available
      </div>
    );
  }

  // Filter locations if a specific location is selected
  const displayLocations = selectedLocationId
    ? stock.locations.filter(ls => {
        // The stock API returns locations with slug as key, which we set as both id and slug
        // The LocationSelector uses location.id from the locations API
        // We need to match the selected location ID with the stock location slug
        const matchingLocation = locations.find(loc => loc.id === selectedLocationId);
        const locationSlug = (matchingLocation?.attributes as any)?.slug;
        
        // Match by direct ID or by slug mapping
        return ls.location.id === selectedLocationId || 
               (locationSlug && ls.location.id === locationSlug);
      })
    : stock.locations.slice(0, maxLocationsDisplay);

  const hasMoreLocations = !selectedLocationId && stock.locations.length > maxLocationsDisplay;

  return (
    <div style={{ 
      border: "1px solid #e0e0e0", 
      borderRadius: "8px", 
      padding: "16px",
      backgroundColor: "#fff"
    }}>
      <div style={{ marginBottom: "16px" }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: "1rem", fontWeight: "600" }}>
          Stock Availability
        </h4>
        
        {showLocationSelector && locations.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <LocationSelector
              locations={locations}
              selectedLocationId={selectedLocationId}
              onLocationChange={setSelectedLocationId}
              loading={locationsLoading}
              placeholder="All locations"
            />
          </div>
        )}

        {/* Total stock summary */}
        {!selectedLocationId && (
          <div style={{ 
            padding: "8px 12px", 
            backgroundColor: "#f5f5f5", 
            borderRadius: "4px",
            marginBottom: "12px"
          }}>
            <div style={{ fontSize: "0.875rem", fontWeight: "500" }}>
              Total Available: {stock.totalAvailable} units
              {stock.totalAllocated > 0 && (
                <span style={{ color: "#666", marginLeft: "8px" }}>
                  ({stock.totalAllocated} allocated)
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Location-specific stock */}
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {displayLocations.map((locationStock) => {
          const availableStock = Number(locationStock.stock.available || 0);
          const allocatedStock = Number(locationStock.stock.allocated || 0);
          
          return (
            <div
              key={locationStock.location.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "8px 12px",
                border: "1px solid #e0e0e0",
                borderRadius: "4px",
                backgroundColor: availableStock > 0 ? "#fff" : "#f9f9f9",
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: "500", fontSize: "0.875rem" }}>
                  {(() => {
                    // Try to find the location name from the locations list
                    const matchingLocation = locations.find(loc => 
                      loc.id === locationStock.location.id || 
                      (loc.attributes as any)?.slug === locationStock.location.id
                    );
                    return matchingLocation?.attributes?.name || locationStock.location.id;
                  })()}
                </div>
                {allocatedStock > 0 && (
                  <div style={{ fontSize: "0.75rem", color: "#666" }}>
                    {allocatedStock} allocated
                  </div>
                )}
              </div>
              
              <div style={{ textAlign: "right" }}>
                <StockIndicator
                  stock={availableStock}
                  threshold={{ low: lowStockThreshold, medium: lowStockThreshold * 4 }}
                  showExact={showStockNumbers}
                />
              </div>
            </div>
          );
        })}

        {hasMoreLocations && (
          <div style={{ 
            padding: "8px 12px", 
            textAlign: "center", 
            color: "#666", 
            fontSize: "0.75rem",
            fontStyle: "italic"
          }}>
            +{stock.locations.length - maxLocationsDisplay} more locations available
          </div>
        )}

        {displayLocations.length === 0 && selectedLocationId && (
          <div style={{ padding: "12px", color: "#666", fontSize: "0.875rem", textAlign: "center" }}>
            No stock information available for selected location
          </div>
        )}
      </div>
    </div>
  );
}