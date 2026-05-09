import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

// Exact Sophia College pickup coordinates
const PICKUP_LAT = 18.96952;
const PICKUP_LNG = 72.80727;
const DEFAULT_ZOOM = 17;

function buildHTML(zoom) {
  return `<!doctype html>
  <html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <style>
      html,body,#map{height:100%;margin:0;padding:0}
    </style>
  </head>
  <body>
    <div id="map"></div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

    <script>
      (function() {

  const zoom = ${zoom};
  // Drivers/ride/selection will be provided via postMessage; start empty
  let drivers = [];
  let selectedDriverId = null;
  let ride = null;

        const map = L.map('map').setView([${PICKUP_LAT}, ${PICKUP_LNG}], zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        // Icons (inline SVG car for crisp rendering)
        const driverIcon = L.icon({
          iconUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="20" viewBox="0 0 36 20"><rect x="1" y="6" width="34" height="8" rx="2" fill="#2ECC71" stroke="#fff" stroke-width="1"/><circle cx="10" cy="16" r="2" fill="#222"/><circle cx="26" cy="16" r="2" fill="#222"/></svg>'),
          iconSize: [36,20],
          iconAnchor: [18,10]
        });

        const selectedDriverIcon = L.icon({
          iconUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="20" viewBox="0 0 36 20"><rect x="1" y="6" width="34" height="8" rx="2" fill="#E74C3C" stroke="#fff" stroke-width="1"/><circle cx="10" cy="16" r="2" fill="#222"/><circle cx="26" cy="16" r="2" fill="#222"/></svg>'),
          iconSize: [36,20],
          iconAnchor: [18,10]
        });

        const pickupIcon = L.icon({
          iconUrl: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect x="0" y="0" width="32" height="32" rx="6" fill="#276EF1"/><text x="16" y="20" font-size="10" fill="#fff" text-anchor="middle" font-family="Arial">S</text></svg>'),
          iconSize: [32,32],
          iconAnchor: [16,16]
        });

        // Pickup marker
        L.marker([${PICKUP_LAT}, ${PICKUP_LNG}], { icon: pickupIcon })
          .addTo(map)
          .bindPopup('Sophia College');

        const markers = new Map();

        // Smoothly animate marker from current position to target
        function animateMarker(marker, toLat, toLng, duration = 800) {
          try {
            const from = marker.getLatLng();
            const start = performance.now();
            function frame(now) {
              const t = Math.min(1, (now - start) / duration);
              const lat = from.lat + (toLat - from.lat) * t;
              const lng = from.lng + (toLng - from.lng) * t;
              marker.setLatLng([lat, lng]);
              if (t < 1) requestAnimationFrame(frame);
            }
            requestAnimationFrame(frame);
          } catch (e) { try { marker.setLatLng([toLat, toLng]); } catch(_){} }
        }

        // OSRM route fetch helper: startArr/endArr are [lat, lng]; returns { points: [[lat,lng],...], duration }
        async function getRoute(startArr, endArr) {
          try {
            const url = 'https://router.project-osrm.org/route/v1/driving/' + startArr[1] + ',' + startArr[0] + ';' + endArr[1] + ',' + endArr[0] + '?overview=full&geometries=geojson';
            const res = await fetch(url);
            const data = await res.json();
            const coords = (data && data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) ? data.routes[0].geometry.coordinates : [];
            const points = coords.map(c => [c[1], c[0]]); // convert [lng,lat] -> [lat,lng]
            const duration = (data && data.routes && data.routes[0] && data.routes[0].duration) ? data.routes[0].duration : null;
            return { points, duration };
          } catch (e) {
            return { points: [], duration: null };
          }
        }

        // Globals for current polyline/car animation and route key
        window.currentPolyline = window.currentPolyline || null;
        window.carMarker = window.carMarker || null;
        window.animationActive = window.animationActive || false;
        window.currentRouteKey = window.currentRouteKey || null;
        window.animationFrameId = window.animationFrameId || null;

        function clearRouteAndAnimation() {
          try { if (window.currentPolyline) { map.removeLayer(window.currentPolyline); window.currentPolyline = null; window.currentRouteKey = null; } } catch (e) {}
          try { if (window.animationFrameId) { cancelAnimationFrame(window.animationFrameId); window.animationFrameId = null; } } catch (e) {}
          window.animationActive = false;
        }

        // haversine distance (meters)
        function haversine(a, b) {
          const R = 6371000;
          const toRad = Math.PI / 180;
          const dLat = (b[0] - a[0]) * toRad;
          const dLon = (b[1] - a[1]) * toRad;
          const lat1 = a[0] * toRad;
          const lat2 = b[0] * toRad;
          const sinDLat = Math.sin(dLat/2);
          const sinDLon = Math.sin(dLon/2);
          const aa = sinDLat*sinDLat + sinDLon*sinDLon * Math.cos(lat1) * Math.cos(lat2);
          const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1-aa));
          return R * c;
        }

        // Build cumulative lengths for polyline points
        function buildLengths(points) {
          const lens = [0];
          let total = 0;
          for (let i = 1; i < points.length; i++) {
            const d = haversine(points[i-1], points[i]);
            total += d;
            lens.push(total);
          }
          return { lens, total };
        }

        // Interpolate position at fraction along route (0..1)
        function getPositionAtFraction(points, lensInfo, frac) {
          if (!points || points.length === 0) return points[0];
          const total = lensInfo.total || 0;
          const target = Math.max(0, Math.min(1, frac)) * total;
          // find segment
          let idx = 0;
          while (idx < lensInfo.lens.length && lensInfo.lens[idx] < target) idx++;
          if (idx === 0) return points[0];
          const segIdx = Math.min(idx, points.length-1);
          const a = points[segIdx-1];
          const b = points[segIdx];
          const segStart = lensInfo.lens[segIdx-1];
          const segLen = lensInfo.lens[segIdx] - segStart;
          const segFrac = segLen > 0 ? (target - segStart) / segLen : 0;
          const lat = a[0] + (b[0] - a[0]) * segFrac;
          const lng = a[1] + (b[1] - a[1]) * segFrac;
          return [lat, lng];
        }

        // Draw route and animate car along points using OSRM duration for timing
        function drawRouteAndAnimate(start, end) {
          try {
            const routeKey = String((start||[]).join(',')) + '->' + String((end||[]).join(',')) + '::' + String((ride && ride.status) || '');
            // if same route already active, don't refetch/recreate
            if (window.currentRouteKey === routeKey && window.currentPolyline) return;
            // clear previous polyline/animation
            clearRouteAndAnimation();
            window.currentRouteKey = routeKey;
            getRoute(start, end).then(({ points, duration }) => {
              if (!points || points.length === 0) return;
              // create new polyline
              try { if (window.currentPolyline) { map.removeLayer(window.currentPolyline); window.currentPolyline = null; } } catch (e) {}
              window.currentPolyline = L.polyline(points, { color: 'blue', weight: 5 }).addTo(map);
              try { map.fitBounds(window.currentPolyline.getBounds(), { padding: [40,40] }); } catch (e) {}

              // create or set car marker
              if (!window.carMarker) {
                window.carMarker = L.marker([start[0], start[1]], { icon: driverIcon }).addTo(map);
              } else {
                try { window.carMarker.setLatLng([start[0], start[1]]); } catch (e) {}
              }

              // prepare lengths and animation timing
              const lensInfo = buildLengths(points);
              const totalDurationMs = (duration && typeof duration === 'number') ? Math.max(1000, Math.round(duration * 1000)) : Math.max(30000, Math.round((lensInfo.total/1000) * 1000));
              const startTime = performance.now();
              window.animationActive = true;

              function frame(now) {
                if (!window.animationActive) return;
                const elapsed = now - startTime;
                let frac = Math.min(1, elapsed / totalDurationMs);
                const pos = getPositionAtFraction(points, lensInfo, frac);
                try { window.carMarker.setLatLng([pos[0], pos[1]]); } catch (e) {}
                if (frac < 1) {
                  window.animationFrameId = requestAnimationFrame(frame);
                } else {
                  window.animationActive = false;
                  window.animationFrameId = null;
                }
              }
              window.animationFrameId = requestAnimationFrame(frame);

              // send ETA update once from OSRM duration
              if (duration != null) {
                const etaMinutes = Math.ceil(duration / 60);
                try { window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ETA_UPDATE', eta: etaMinutes })); } catch (e) {}
              }
            }).catch(() => {});
          } catch (e) {}
        }

        function ensureDriverMarker(d) {
          const key = d.id ? d.id : (d.latitude + "_" + d.longitude);

          if (markers.has(key)) return markers.get(key);

          const marker = L.marker(
            [Number(d.latitude), Number(d.longitude)],
            { icon: driverIcon }
          ).addTo(map);

          markers.set(key, marker);
          return marker;
        }

        function updateDrivers(driversArr, rideObj, selId) {
          if (!Array.isArray(driversArr)) return;
          drivers = driversArr || [];
          ride = rideObj || null;
          selectedDriverId = selId || null;
          drivers.forEach(d => {
            const marker = ensureDriverMarker(d);
            if (!marker) return;
            animateMarker(marker, Number(d.latitude) || 0, Number(d.longitude) || 0, 700);
            try { if (selectedDriverId && d.id === selectedDriverId) marker.setIcon(selectedDriverIcon); else marker.setIcon(driverIcon); } catch(e){}
          });
          // Optionally draw route for active ride and animate car
          try {
            if (ride && ride.pickupLocation) {
              const status = String(ride.status || '').toUpperCase();
              // BEFORE PICKUP: driver -> pickup (ACCEPTED)
              if (status === 'ACCEPTED') {
                if (drivers && drivers.length > 0) {
                  const drv = drivers.find(d => d.id === selectedDriverId) || drivers[0];
                  if (drv && typeof drv.latitude === 'number') {
                    const start = [Number(drv.latitude), Number(drv.longitude)];
                    const end = [ride.pickupLocation.latitude, ride.pickupLocation.longitude];
                    drawRouteAndAnimate(start, end);
                  }
                }
              }
              // ONGOING: pickup -> drop
              if (status === 'ONGOING' && (ride.dropLocation || ride.destination)) {
                const start = [ride.pickupLocation.latitude, ride.pickupLocation.longitude];
                const drop = ride.dropLocation || ride.destination;
                if (drop && typeof drop.latitude === 'number') {
                  const end = [drop.latitude, drop.longitude];
                  drawRouteAndAnimate(start, end);
                }
              }
            }
          } catch (e) {}
        }

        function handleMessage(e) {
          try {
            const payload = (typeof e.data === 'string') ? JSON.parse(e.data) : e.data;
            if (!payload) return;
            if (payload.type === 'update') {
              updateDrivers(payload.drivers || [], payload.ride || null, payload.selectedDriverId || null);
              // Optionally post back ETA or events
            }
          } catch(err){}
        }

        document.addEventListener('message', handleMessage);
        window.addEventListener('message', handleMessage);

      })();
    </script>
  </body>
  </html>`;
}

export default function MapComponent({
  drivers = [],
  selectedDriverId = null,
  ride = null,
  onMessage = null
}) {
  const webRef = useRef(null);

  const html = buildHTML(
    DEFAULT_ZOOM,
    JSON.stringify(drivers),
    JSON.stringify(selectedDriverId),
    JSON.stringify(ride)
  );

  useEffect(() => {
    if (!webRef.current) return;
    try {
      const payload = { type: 'update', drivers: Array.isArray(drivers) ? drivers : [], ride: ride || null, selectedDriverId: selectedDriverId || null };
      webRef.current.postMessage(JSON.stringify(payload));
    } catch (e) {}
  }, [drivers, ride, selectedDriverId]);

  return (
    <View style={styles.container}>
      <WebView
        ref={webRef}
        originWhitelist={["*"]}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        onMessage={(e) => {
          try {
            const data = JSON.parse(e.nativeEvent.data);
            if (onMessage) onMessage(data);
          } catch {}
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 }
});