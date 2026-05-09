import { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, TouchableWithoutFeedback, View } from 'react-native';

const { height } = Dimensions.get('window');

export default function BottomSheet({ visible = false, heightRatio = 0.4, children, onClose = null, blockBackgroundTouches = true }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: visible ? 1 : 0, duration: 250, useNativeDriver: true }).start();
  }, [visible]);

  const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [height * heightRatio, 0] });

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents={visible ? 'auto' : 'none'}>
      <TouchableWithoutFeedback onPress={() => onClose && onClose()}>
        <View style={[styles.backdrop, !blockBackgroundTouches && { backgroundColor: 'transparent' }]} pointerEvents={blockBackgroundTouches ? 'auto' : 'none'} />
      </TouchableWithoutFeedback>
      <Animated.View style={[styles.sheet, { height: height * heightRatio, transform: [{ translateY }] }]}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, zIndex: 1000 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 12 },
});
