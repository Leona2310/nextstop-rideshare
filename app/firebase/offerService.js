import { Platform } from 'react-native';
import { fetch } from 'react-native-ssl-pinning'; // optional; fallback to global fetch

// Replace BASE_FUNCTIONS_URL with your deployed functions domain, e.g. https://us-central1-<proj>.cloudfunctions.net
const BASE_FUNCTIONS_URL = global.BACKEND_URL || 'https://us-central1-nextstop-d8864.cloudfunctions.net';

export async function offerRide(rideId, driverId, offerTimeoutSeconds = 30) {
  const url = `${BASE_FUNCTIONS_URL}/offerRide`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rideId, driverId, offerTimeoutSeconds }),
  });
  if (!resp.ok) throw new Error('Failed to create offer');
  return resp.json();
}

export async function claimRide(rideId, driverId, offerId = null) {
  const url = `${BASE_FUNCTIONS_URL}/claimRide`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rideId, driverId, offerId }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Claim failed: ${text}`);
  }
  return resp.json();
}
