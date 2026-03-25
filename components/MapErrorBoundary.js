import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

class MapErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log the error to console so the app doesn't crash silently
    console.error('MapErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Map unavailable</Text>
          <Text style={styles.message}>Unable to load the map. Please try again or check your device permissions.</Text>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 16 },
  title: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  message: { fontSize: 13, color: '#444', textAlign: 'center' },
});

export default MapErrorBoundary;
