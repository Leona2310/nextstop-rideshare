import { useState } from "react";
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
} from "react-native";
import { getFriendlyAuthError, signup } from "../firebase/authService";
import { isValidDomain } from "../utils/domainValidator";

export default function SignupScreen({ navigation }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!isValidDomain(email.trim())) {
      Alert.alert("Invalid Email", "Use official college email");
      return;
    }
    if (!password || password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    try {
      const { userCredential, verificationSent } = await signup(email.trim(), password);
      if (verificationSent) {
        Alert.alert("Verify Email", "Verification link sent — check your email");
      } else {
        Alert.alert("Account created", "Account was created but verification email could not be sent. Please check your email settings or try resending from the app.");
      }
      navigation.navigate("OTP");
    } catch (e) {
      const msg = getFriendlyAuthError(e);
      Alert.alert("Signup Failed", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.inner}>
        <View style={styles.card}>
          <Text style={styles.title}>Create account</Text>

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
              placeholder="Password (min 6)"
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              placeholderTextColor="#888"
            />
            <TouchableOpacity onPress={() => setShowPassword(s => !s)} style={styles.showBtn}>
              <Text style={styles.showBtnText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={handleSignup} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Sign up</Text>}
          </TouchableOpacity>

          <View style={{ marginTop: 12, alignItems: 'center' }}>
            <TouchableOpacity onPress={() => navigation.navigate('Login')}>
              <Text style={styles.link}>Already have an account? Login</Text>
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 20, elevation: 3 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e3e6ee', padding: 12, borderRadius: 8, marginBottom: 12, color: '#111' },
  primaryBtn: { backgroundColor: '#22A07A', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 6 },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  link: { color: '#276EF1' },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  showBtn: { padding: 10 },
  showBtnText: { color: '#276EF1' }
});
