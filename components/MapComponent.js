import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Fixed pickup location: Sophia College (Mumbai) — fallback center when userLocation is null
const SOPHIA_COLLEGE_COORDS = { latitude: 19.0217, longitude: 72.8309 };

/**
 * MapComponent
 * Props:
 *  - userLocation: { latitude, longitude } | null
 *  - drivers: Array<{ id, latitude, longitude }>
 *  - selectedDriverId: string|null
 *
 * Uses a WebView rendering a Leaflet map (OpenStreetMap tiles), and updates markers
 * via postMessage. Always safe when location is null.
 */
export default function MapComponent({ userLocation = null, drivers = [], selectedDriverId = null }) {
  const webRef = useRef(null);

  const initialData = useMemo(() => ({
    userLocation,
    drivers,
    selectedDriverId,
    pickup: SOPHIA_COLLEGE_COORDS,
  }), []);

  // HTML string with Leaflet map. It listens for messages from React Native to update markers.
  const html = useMemo(() => {
    const initial = JSON.stringify(initialData);
    return `<!doctype html>
<html>
  <head>
    <meta name="viewport" content="initial-scale=1.0, maximum-scale=1.0">
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html,body,#map{ height:100%; margin:0; padding:0 }
      .leaflet-container { background: #fff; }
    </style>
  </head>
  <body>
    <div id="map"></div>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script>
      (function(){
        const data = ${initial};
        // Create map centered on userLocation or pickup fallback
        const center = (data.userLocation && data.userLocation.latitude && data.userLocation.longitude) ? [data.userLocation.latitude, data.userLocation.longitude] : [data.pickup.latitude, data.pickup.longitude];
        const map = L.map('map', { zoomControl: true }).setView(center, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors'
        }).addTo(map);

        // Layer for markers
        let markersLayer = L.layerGroup().addTo(map);

        function addMarkers(payload) {
          // clear
          markersLayer.clearLayers();

          // pickup marker (Sophia College)
          try {
            const p = payload.pickup;
            if (p && typeof p.latitude === 'number' && typeof p.longitude === 'number') {
              const pickup = L.circleMarker([p.latitude, p.longitude], { color: '#0000FF', radius: 8, weight: 2 }).bindPopup('Pickup: Sophia College');
              markersLayer.addLayer(pickup);
            }
          } catch (e) { console.warn('pickup marker error', e); }

          // user marker (blue)
          try {
            const u = payload.userLocation;
            if (u && typeof u.latitude === 'number' && typeof u.longitude === 'number') {
              const um = L.circleMarker([u.latitude, u.longitude], { color: '#0000FF', radius: 8, weight: 2 }).bindPopup('You are here');
              markersLayer.addLayer(um);
            }
          } catch (e) { console.warn('user marker error', e); }

          // drivers (green) and selected driver (red)
          try {
            const drivers = Array.isArray(payload.drivers) ? payload.drivers : [];
            drivers.forEach(d => {
              if (d && typeof d.latitude === 'number' && typeof d.longitude === 'number') {
                const isSelected = d.id == payload.selectedDriverId;
                const color = isSelected ? '#FF0000' : '#22AA22';
                const marker = L.circleMarker([d.latitude, d.longitude], { color, radius: isSelected ? 9 : 6, weight: 2 });
                marker.on('click', function(){
                  try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'driver_click', id: d.id })); } catch (e) {}
                });
                markersLayer.addLayer(marker);
              }
            });
          } catch (e) { console.warn('drivers marker error', e); }
        }

        // Initial markers
        addMarkers(data);

        // Ensure map fits at least around pickup/user markers but don't force panic when null
        try {
          const group = markersLayer.getLayers();
          if (group && group.length > 0) {
            const g = L.featureGroup(group);
            map.fitBounds(g.getBounds(), { maxZoom: 16, padding: [50,50] });
          }
        } catch (e) {}

        // Message handler for updates from React Native
        function onMessage(event) {
          try {
            const payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (!payload) return;
            if (payload.type === 'update') {
              addMarkers(payload);
            }
          } catch (err) {
            console.warn('map onMessage parse error', err);
          }
        }

        // Support multiple platforms for message events
        document.addEventListener('message', onMessage);
        window.addEventListener('message', onMessage);

        // expose a safe ping
        window.mapReady = true;
      })();
    </script>
  </body>
</html>`;
  }, [initialData]);

  // send updates when props change
  useEffect(() => {
    const payload = JSON.stringify({ type: 'update', userLocation, drivers, selectedDriverId, pickup: SOPHIA_COLLEGE_COORDS });
    if (webRef.current && webRef.current.postMessage) {
      try { webRef.current.postMessage(payload); } catch (e) { /* ignore */ }
    }
  }, [userLocation, drivers, selectedDriverId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.web}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  web: { flex: 1, backgroundColor: 'transparent' },
});
