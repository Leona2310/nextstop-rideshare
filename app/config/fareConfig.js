// Pricing model inspired by ride-hailing apps (base + distance * perKm + time * perMin + booking fee)
export const VEHICLE_FARES = {
  GO: { baseFare: 40, perKm: 12, perMin: 1 },
  SEDAN: { baseFare: 60, perKm: 15, perMin: 1.5 },
  XL: { baseFare: 90, perKm: 20, perMin: 2 }
};

// Flat booking fee (platform fee)
export const BOOKING_FEE = 15;

// Minimum fare to ensure tiny trips still pay something
export const MINIMUM_FARE = 35;

// Optional surge multiplier (1 = no surge)
export const SURGE_MULTIPLIER = 1;

/**
 * Compute fare using distance (km) and duration (min) and vehicle type key
 * Returns rounded integer fare
 */
export function calculateFare({ distanceKm, durationMin, vehicleKey = 'GO', tip = 0, surge = SURGE_MULTIPLIER }) {
  const cfg = VEHICLE_FARES[vehicleKey] || VEHICLE_FARES.GO;
  const distanceCharge = (distanceKm || 0) * cfg.perKm;
  const timeCharge = (durationMin || 0) * cfg.perMin;
  const raw = cfg.baseFare + distanceCharge + timeCharge + BOOKING_FEE + (tip || 0);
  const surged = raw * (surge || 1);
  const fare = Math.max(MINIMUM_FARE, Math.round(surged));
  return fare;
}
