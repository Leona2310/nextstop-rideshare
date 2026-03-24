import { useEffect, useRef, useState } from 'react';
import { Alert, StyleSheet, View, Text } from 'react-native';
import MapView, { Marker, UrlTile, Polyline } from 'react-native-maps';
import { subscribeToActiveDrivers } from '../app/firebase/driverLocationService';
import { getCurrentLocation } from '../app/services/locationService';
import { provider, MAPTILER_KEY, THUNDERFOREST_KEY } from '../app/config/mapConfig';

const MapComponent = ({ showUserLocation = true, onDriverSelect = null, selectedDriverId = null, routeCoordinates = [], selectedDriverLive = null, followDriver = false }) => {
  const [drivers, setDrivers] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [region, setRegion] = useState({
    latitude: 28.6139, // Default to Delhi, India - replace with campus coordinates
    longitude: 77.2090,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  const mapRef = useRef(null);

  // When followDriver is enabled, center the map on selectedDriverLive updates
  useEffect(() => {
    if (followDriver && selectedDriverLive && mapRef.current && selectedDriverLive.latitude && selectedDriverLive.longitude) {
      try {
        mapRef.current.animateToRegion({
          latitude: selectedDriverLive.latitude,
          longitude: selectedDriverLive.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }, 500);
      } catch (e) {
        // some platforms might use animateCamera instead
        try { mapRef.current.animateCamera({ center: { latitude: selectedDriverLive.latitude, longitude: selectedDriverLive.longitude }, zoom: 16 }, { duration: 500 }); } catch (err) {}
      }
    }
  }, [followDriver, selectedDriverLive]);

  useEffect(() => {
    // Subscribe to active drivers
    const unsubscribe = subscribeToActiveDrivers((activeDrivers) => {
      setDrivers(activeDrivers);
    });

    // Get user location if needed
    if (showUserLocation) {
      getCurrentLocation().then((location) => {
        if (location) {
          setUserLocation(location);
          // Optionally center map on user location
          setRegion({
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          });
        }
      });
    }

    return unsubscribe;
  }, [showUserLocation]);

  const handleDriverPress = (driver) => {
    if (onDriverSelect) {
      onDriverSelect(driver);
    } else {
      Alert.alert(
        'Driver Info',
        `Driver ID: ${driver.driverId}\nSpeed: ${driver.speed} km/h\nAvailable: ${driver.isAvailable ? 'Yes' : 'No'}`
      );
    }
  };

  const usingFallbackOSM = !(provider === 'maptiler' && MAPTILER_KEY && MAPTILER_KEY !== 'YOUR_MAPTILER_API_KEY') && !(provider === 'thunderforest' && THUNDERFOREST_KEY && THUNDERFOREST_KEY !== 'YOUR_THUNDERFOREST_API_KEY');

  useEffect(() => {
    if (usingFallbackOSM) {
      console.warn('Using default OpenStreetMap tiles. For production, configure MapTiler or Thunderforest in app/config/mapConfig.js');
    }
  }, [usingFallbackOSM]);

  return (
    <View style={styles.container}>
      <MapView
        ref={mapRef}
        style={styles.map}
        region={region}
        showsUserLocation={showUserLocation}
        showsMyLocationButton={true}
        zoomEnabled={true}
        scrollEnabled={true}
      >
          {/* Tile layer (provider configured) */}
          {provider === 'maptiler' && MAPTILER_KEY && MAPTILER_KEY !== 'YOUR_MAPTILER_API_KEY' ? (
            <UrlTile urlTemplate={`https://api.maptiler.com/tiles/streets/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`} maximumZ={20} flipY={false} />
          ) : provider === 'thunderforest' && THUNDERFOREST_KEY && THUNDERFOREST_KEY !== 'YOUR_THUNDERFOREST_API_KEY' ? (
            <UrlTile urlTemplate={`https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=${THUNDERFOREST_KEY}`} maximumZ={20} flipY={false} />
          ) : (
            // Fallback: default OpenStreetMap tile server (not for production)
            <UrlTile urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
          )}

        {/* Driver markers */}
        {drivers.map((driver) => {
          const isSelected = selectedDriverId === driver.driverId;
          // If we have selectedDriverLive prop, show that instead for the selected driver to make marker smooth/real-time
          const coord = isSelected && selectedDriverLive ? { latitude: selectedDriverLive.latitude, longitude: selectedDriverLive.longitude } : { latitude: driver.latitude, longitude: driver.longitude };
          const rotation = isSelected && (selectedDriverLive?.heading || driver.heading) ? (selectedDriverLive?.heading || driver.heading) : 0;
          return (
            <Marker
                key={driver.id}
                coordinate={coord}
                title={`Driver ${driver.driverId}`}
                description={`Speed: ${Math.round(driver.speed || 0)} km/h`}
                onPress={() => handleDriverPress(driver)}
                anchor={{ x: 0.5, y: 0.5 }}
                rotation={rotation}
              >
                {isSelected ? (
                  // custom rotating car marker for selected driver
                  <View style={{ transform: [{ rotate: `${rotation}deg` }], alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontSize: 28 }}>🚗</Text>
                  </View>
                ) : (
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: (driver.isAvailable ? 'green' : 'red') }} />
                )}
              </Marker>
          );
        })}

        {/* Route polyline if provided */}
  {Array.isArray(routeCoordinates) && routeCoordinates.length > 0 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeColor="#276EF1"
            strokeWidth={4}
          />
        )}
      </MapView>
      {/* If we're using the OSM fallback, show a clear on-screen notice so the user knows tiles may be blocked */}
      {usingFallbackOSM && (
        <View style={styles.fallbackNotice} pointerEvents="none">
          <View style={styles.fallbackInner}>
            <Text style={styles.fallbackTitle}>Map tiles limited</Text>
            <Text style={styles.fallbackText}>You're using the default OpenStreetMap tile server. This server is intended for light use and may show 'Access blocked' overlays in apps. Configure a tile provider (MapTiler/Thunderforest) and add an API key in app/config/mapConfig.js to remove this warning.</Text>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  fallbackNotice: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 10,
  },
  fallbackInner: {
    flexDirection: 'column',
  },
  fallbackTitle: {
    color: '#fff',
    fontWeight: 'bold',
    marginBottom: 4,
  },
  fallbackText: {
    color: '#fff',
    fontSize: 12,
  },
});

export default MapComponent;
