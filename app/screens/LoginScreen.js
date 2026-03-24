import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { loginUser, getFriendlyAuthError } from '../firebase/authService';
import { auth } from '../firebase/firebaseConfig';

export default function LoginScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true);
    try {
      await loginUser(email.trim(), password);

      // Log token for backend debugging (optional)
      if (auth.currentUser) {
        const idToken = await auth.currentUser.getIdToken(true);
        console.log('ID_TOKEN:', idToken);
      }

      // Do NOT call navigation.replace here.
      // Central onAuthStateChanged in app/index.js will detect the signed-in user
      // and route to OTP/ProfileSetup/Home as appropriate.
      Alert.alert('Signed in', 'You are signed in. Routing will happen automatically.');

    } catch (error) {
      const msg = getFriendlyAuthError(error);
      Alert.alert('Login Failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.inner}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Welcome back</Text>

          <TextInput
            style={styles.input}
            placeholder="College email"
            keyboardType="email-address"
            autoCapitalize="none"
            value={email}
            onChangeText={setEmail}
            placeholderTextColor="#888"
          />

          <View style={styles.passwordRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              placeholder="Password"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              placeholderTextColor="#888"
            />
            <TouchableOpacity onPress={() => setShowPassword(s => !s)} style={styles.showBtn}>
              <Text style={styles.showBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleLogin} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Login</Text>}
          </TouchableOpacity>

          <View style={styles.row}>
            <TouchableOpacity onPress={() => navigation.navigate('ForgotPassword')}>
              <Text style={styles.link}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('Signup')}>
              <Text style={styles.link}>Register</Text>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f7f8fb' },
  inner: { flex: 1, justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    elevation: 3
  },
  title: { fontSize: 22, fontWeight: '600', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#e3e6ee',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    color: '#111'
  },
  primaryBtn: {
    backgroundColor: '#276EF1',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 6
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  link: { color: '#276EF1' },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  showBtn: { padding: 10 },
  showBtnText: { color: '#276EF1' }
});
