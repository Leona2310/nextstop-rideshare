// OpenStreetMap Nominatim base URL for search/geocoding
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
// OSRM public routing server (demo) for road distance/duration. Note: subject to rate limits.
const OSRM_BASE = 'https://router.project-osrm.org';

/**
 * Request location permissions from user
 * @returns {Promise<boolean>} true if granted, false otherwise
 */
// Stubbed: we no longer request runtime location permissions here per project requirement.
export async function requestLocationPermission() {
  return false;
}

/**
 * Request background location permissions (for continuous tracking)
 * @returns {Promise<boolean>} true if granted, false otherwise
 */
export async function requestBackgroundLocationPermission() {
  return false;
}

/**
 * Get current location
 * @returns {Promise<{latitude: number, longitude: number} | null>}
 */
// Returning null to force MapComponent to use default center; do not attempt to fetch device location.
export async function getCurrentLocation() {
  return null;
}

/**
 * Reverse geocode coordinates to a human-readable address
 * Returns formatted address string or a simple lat,lng fallback
 */
export async function reverseGeocodeToAddress(lat, lon) {
  try {
    // Use Nominatim reverse geocoding (OpenStreetMap)
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&addressdetails=1`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NextStopApp/1.0' } });
    if (!resp.ok) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const json = await resp.json();
    if (!json) return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    const addr = json.address || {};
    const parts = [];
    if (addr.road) parts.push(addr.road);
    if (addr.suburb) parts.push(addr.suburb);
    if (addr.city) parts.push(addr.city);
    if (addr.state) parts.push(addr.state);
    if (addr.postcode) parts.push(addr.postcode);
    if (addr.country) parts.push(addr.country);
    const formatted = parts.join(', ');
    return formatted || (json.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  } catch (err) {
    console.warn('reverseGeocode (Nominatim) failed', err);
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
  }
}


/**
 * Get road distance (in kilometers) between two coordinates using Google Distance Matrix API.
 * Falls back to straight-line haversine distance when API key is not provided or request fails.
 * Returns { distanceKm, via: 'road'|'straight' }
 */
export async function getRoadDistanceKm(pickup, drop) {
  try {
    if (!pickup || !drop) throw new Error('Missing coordinates');
    // Use OSRM route service to get driving distance and duration
    const coords = `${pickup.longitude},${pickup.latitude};${drop.longitude},${drop.latitude}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=false&alternatives=false&annotations=distance,duration`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('OSRM route request failed', resp.status);
      const d = calculateDistance(pickup.latitude, pickup.longitude, drop.latitude, drop.longitude);
      return { distanceKm: d, via: 'straight', durationMin: Math.round((d / 30) * 60) };
    }
    const json = await resp.json();
    if (!json || !json.routes || json.routes.length === 0) {
      const d = calculateDistance(pickup.latitude, pickup.longitude, drop.latitude, drop.longitude);
      return { distanceKm: d, via: 'straight', durationMin: Math.round((d / 30) * 60) };
    }
    const route = json.routes[0];
    const meters = route.distance; // meters
    const seconds = route.duration; // seconds
    const km = meters / 1000;
    const durationMin = Math.round(seconds / 60);
    return { distanceKm: km, via: 'road', durationMin };
  } catch (err) {
    console.error('getRoadDistanceKm failed', err);
    const d = calculateDistance(pickup.latitude, pickup.longitude, drop.latitude, drop.longitude);
    return { distanceKm: d, via: 'straight', durationMin: Math.round((d / 30) * 60) };
  }
}

/**
 * Get full driving route between two coordinates using OSRM and return geometry + distance + duration
 * @param {{latitude:number,longitude:number}} from
 * @param {{latitude:number,longitude:number}} to
 * @returns {Promise<{distanceKm:number,durationMin:number,coordinates:Array<{latitude:number,longitude:number}>}>}
 */
export async function getRouteBetweenCoords(from, to) {
  try {
    if (!from || !to) throw new Error('Missing coordinates');
    const coords = `${from.longitude},${from.latitude};${to.longitude},${to.latitude}`;
    const url = `${OSRM_BASE}/route/v1/driving/${coords}?overview=full&geometries=geojson&alternatives=false&annotations=distance,duration`;
    const resp = await fetch(url);
    if (!resp.ok) {
      console.warn('OSRM route request failed', resp.status);
      const d = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      return { distanceKm: d, durationMin: calculateETA(d), coordinates: [] };
    }
    const json = await resp.json();
    if (!json || !json.routes || json.routes.length === 0) {
      const d = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
      return { distanceKm: d, durationMin: calculateETA(d), coordinates: [] };
    }
    const route = json.routes[0];
    const meters = route.distance;
    const seconds = route.duration;
    const km = meters / 1000;
    const durationMin = Math.round(seconds / 60);
    // route.geometry.coordinates is an array of [lon, lat]
    const coordsArray = (route.geometry && route.geometry.coordinates) || [];
    const coordinates = coordsArray.map(c => ({ latitude: c[1], longitude: c[0] }));
    return { distanceKm: km, durationMin, coordinates };
  } catch (err) {
    console.error('getRouteBetweenCoords failed', err);
    const d = calculateDistance(from.latitude, from.longitude, to.latitude, to.longitude);
    return { distanceKm: d, durationMin: calculateETA(d), coordinates: [] };
  }
}

/**
 * Search for place predictions using OpenStreetMap Nominatim (autocomplete-like).
 * Returns array of { description, place_id, latitude, longitude, address }
 */
export async function getPlacePredictions(input) {
  try {
    if (!input || input.trim().length < 1) return [];
    // Bias to Mumbai by appending city name to the query
    const q = `${input} Mumbai`;
    const url = `${NOMINATIM_BASE}/search?format=json&addressdetails=1&limit=6&q=${encodeURIComponent(q)}&countrycodes=in`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NextStopApp/1.0' } });
    if (!resp.ok) return [];
    const json = await resp.json();
    if (!Array.isArray(json)) return [];
    return json.map(p => ({
      description: p.display_name,
      place_id: p.osm_id || null,
      latitude: parseFloat(p.lat),
      longitude: parseFloat(p.lon),
      address: p.display_name
    }));
  } catch (err) {
    console.warn('getPlacePredictions (Nominatim) failed', err);
    return [];
  }
}

/**
 * Get place details. For Nominatim we may get a prediction object directly, or lookup by osm id.
 * Returns { address, latitude, longitude } or null
 */
export async function getPlaceDetails(placeIdOrPrediction) {
  try {
    if (!placeIdOrPrediction) return null;
    if (typeof placeIdOrPrediction === 'object') {
      return {
        address: placeIdOrPrediction.address || placeIdOrPrediction.description,
        latitude: placeIdOrPrediction.latitude,
        longitude: placeIdOrPrediction.longitude
      };
    }

    const url = `${NOMINATIM_BASE}/lookup?format=json&addressdetails=1&osm_ids=${encodeURIComponent(placeIdOrPrediction)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'NextStopApp/1.0' } });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const r = json[0];
    return {
      address: r.display_name,
      latitude: parseFloat(r.lat),
      longitude: parseFloat(r.lon)
    };
  } catch (err) {
    console.warn('getPlaceDetails (Nominatim) failed', err);
    return null;
  }
}

/**
 * Return fixed pickup location for Sophia College, Mumbai by querying Nominatim once.
 */
// Return a stable, hardcoded pickup location for Sophia College per requirement.
export async function getFixedSophiaPickup() {
  return {
    address: 'Sophia College Auditorium, Sophia College Lane (near Vivek Singh Lane), Mumbai',
  latitude: 18.96952,
    longitude: 72.8078,
  };
}

// (Removed duplicate Google Places getPlaceDetails) We use Nominatim-based getPlaceDetails above.

/**
 * Watch location changes
 * @param {Function} callback - Called with new location
 * @returns {Promise<Object>} subscription object with remove() method
 */
export async function watchLocation(callback) {
  // Watching location is not supported in this configuration. Throw to indicate unsupported.
  throw new Error('watchLocation is not supported: location APIs removed per project constraints');
}

/**
 * Calculate distance between two coordinates (Haversine formula)
 * @param {number} lat1 
 * @param {number} lon1 
 * @param {number} lat2 
 * @param {number} lon2 
 * @returns {number} distance in kilometers
 */
export function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate ETA based on distance and average speed
 * @param {number} distanceKm - Distance in kilometers
 * @param {number} avgSpeedKmh - Average speed in km/h (default: 30)
 * @returns {number} ETA in minutes
 */
export function calculateETA(distanceKm, avgSpeedKmh = 30) {
  const hours = distanceKm / avgSpeedKmh;
  return Math.round(hours * 60);
}

/**
 * Format ETA for display
 * @param {number} minutes 
 * @returns {string}
 */
export function formatETA(minutes) {
  if (minutes < 1) return '< 1 min';
  if (minutes < 60) return `${minutes} min`;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
