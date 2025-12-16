import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';

interface ComparableLocation {
  id: string;
  listing_name: string | null;
  location_info: {
    lat?: number;
    lng?: number;
    locality?: string;
  } | null;
  performance_metrics: {
    ttm_revenue?: number;
    ttm_occupancy?: number;
    ttm_adr?: number;
  } | null;
  is_selected: boolean;
}

interface ComparablesMapProps {
  subjectLatitude: number;
  subjectLongitude: number;
  comparables: ComparableLocation[];
  selectedIds: Set<string>;
  radiusMiles: number;
  mapboxToken: string;
}

export function ComparablesMap({
  subjectLatitude,
  subjectLongitude,
  comparables,
  selectedIds,
  radiusMiles,
  mapboxToken,
}: ComparablesMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);

  const formatCurrency = (value?: number) => {
    if (value === undefined || value === null) return 'N/A';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatPercent = (value?: number) => {
    if (value === undefined || value === null) return 'N/A';
    return `${(value * 100).toFixed(0)}%`;
  };

  useEffect(() => {
    if (!mapContainer.current || !mapboxToken) return;

    mapboxgl.accessToken = mapboxToken;

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/light-v11',
      center: [subjectLongitude, subjectLatitude],
      zoom: 10,
    });

    map.current.addControl(new mapboxgl.NavigationControl(), 'top-right');

    // Add radius circle when map loads
    map.current.on('load', () => {
      if (!map.current) return;

      // Convert miles to meters for the circle
      const radiusMeters = radiusMiles * 1609.34;

      // Add circle source and layer
      map.current.addSource('radius-circle', {
        type: 'geojson',
        data: {
          type: 'Feature',
          geometry: {
            type: 'Point',
            coordinates: [subjectLongitude, subjectLatitude],
          },
          properties: {},
        },
      });

      map.current.addLayer({
        id: 'radius-circle-fill',
        type: 'circle',
        source: 'radius-circle',
        paint: {
          'circle-radius': {
            stops: [
              [0, 0],
              [20, radiusMeters / 0.075],
            ],
            base: 2,
          },
          'circle-color': 'hsl(217, 91%, 60%)',
          'circle-opacity': 0.1,
          'circle-stroke-width': 2,
          'circle-stroke-color': 'hsl(217, 91%, 60%)',
          'circle-stroke-opacity': 0.4,
        },
      });
    });

    return () => {
      map.current?.remove();
    };
  }, [subjectLatitude, subjectLongitude, radiusMiles, mapboxToken]);

  // Update markers when comparables or selections change
  useEffect(() => {
    if (!map.current) return;

    // Clear existing markers
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];

    // Add subject property marker
    const subjectEl = document.createElement('div');
    subjectEl.className = 'subject-marker';
    subjectEl.style.cssText = `
      width: 32px;
      height: 32px;
      background-color: hsl(217, 91%, 60%);
      border: 3px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      cursor: pointer;
    `;

    const subjectPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(`
      <div style="padding: 8px; font-family: system-ui, sans-serif;">
        <strong style="color: hsl(217, 91%, 60%);">Your Property</strong>
      </div>
    `);

    const subjectMarker = new mapboxgl.Marker(subjectEl)
      .setLngLat([subjectLongitude, subjectLatitude])
      .setPopup(subjectPopup)
      .addTo(map.current);
    markersRef.current.push(subjectMarker);

    // Add comparable markers
    const bounds = new mapboxgl.LngLatBounds();
    bounds.extend([subjectLongitude, subjectLatitude]);

    comparables.forEach((comp) => {
      const lat = comp.location_info?.lat;
      const lng = comp.location_info?.lng;
      if (!lat || !lng) return;

      const isSelected = selectedIds.has(comp.id);

      const el = document.createElement('div');
      el.style.cssText = `
        width: 24px;
        height: 24px;
        background-color: ${isSelected ? 'hsl(142, 76%, 36%)' : 'hsl(215, 14%, 70%)'};
        border: 2px solid white;
        border-radius: 50%;
        box-shadow: 0 2px 6px rgba(0,0,0,0.25);
        cursor: pointer;
        transition: transform 0.2s;
      `;
      el.onmouseenter = () => {
        el.style.transform = 'scale(1.2)';
      };
      el.onmouseleave = () => {
        el.style.transform = 'scale(1)';
      };

      const popup = new mapboxgl.Popup({ offset: 20 }).setHTML(`
        <div style="padding: 12px; font-family: system-ui, sans-serif; min-width: 180px;">
          <strong style="font-size: 14px; color: ${isSelected ? 'hsl(142, 76%, 36%)' : 'hsl(215, 25%, 27%)'};">
            ${comp.listing_name || 'Unknown Property'}
          </strong>
          ${comp.location_info?.locality ? `<p style="margin: 4px 0 8px; color: #666; font-size: 12px;">${comp.location_info.locality}</p>` : ''}
          <div style="display: grid; gap: 4px; font-size: 13px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #888;">TTM Revenue:</span>
              <strong>${formatCurrency(comp.performance_metrics?.ttm_revenue)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #888;">Occupancy:</span>
              <strong>${formatPercent(comp.performance_metrics?.ttm_occupancy)}</strong>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <span style="color: #888;">ADR:</span>
              <strong>${formatCurrency(comp.performance_metrics?.ttm_adr)}</strong>
            </div>
          </div>
          ${isSelected ? '<div style="margin-top: 8px; padding: 4px 8px; background: hsl(142, 76%, 95%); color: hsl(142, 76%, 36%); border-radius: 4px; font-size: 11px; text-align: center;">Selected</div>' : ''}
        </div>
      `);

      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .setPopup(popup)
        .addTo(map.current!);

      markersRef.current.push(marker);
      bounds.extend([lng, lat]);
    });

    // Fit map to show all markers
    if (comparables.length > 0) {
      map.current.fitBounds(bounds, {
        padding: 50,
        maxZoom: 12,
      });
    }
  }, [comparables, selectedIds, subjectLatitude, subjectLongitude]);

  return (
    <div className="relative w-full h-[400px] rounded-lg overflow-hidden border">
      <div ref={mapContainer} className="absolute inset-0" />
      <div className="absolute bottom-3 left-3 bg-background/90 backdrop-blur-sm rounded-md px-3 py-2 text-xs space-y-1">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-primary border border-white" />
          <span>Your Property</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-green-600 border border-white" />
          <span>Selected</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-muted-foreground/50 border border-white" />
          <span>Available</span>
        </div>
      </div>
    </div>
  );
}
