import { sendEmailVerification, signOut } from "firebase/auth";
import { getFriendlyAuthError } from '../firebase/authService';
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { auth } from "../firebase/firebaseConfig";

export default function OTPScreen({ navigation }) {
  const [checking, setChecking] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    let t;
    if (cooldown > 0) {
      t = setInterval(() => setCooldown(c => Math.max(0, c - 1)), 1000);
    }
    return () => clearInterval(t);
  }, [cooldown]);

  /* ================= CHECK VERIFICATION ================= */

  const checkVerification = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Not signed in", "Please sign in again");
      return;
    }

    setChecking(true);
    try {
      await user.reload();

      if (!user.emailVerified) {
        Alert.alert("Not Verified", "Please verify your email (check spam)");
        return;
      }

      // 🔥 CRITICAL LINE — forces onAuthStateChanged to re-run
      await user.getIdToken(true);

      // ❌ DO NOT NAVIGATE HERE
      // ✅ index.js will handle routing automatically

    } catch (e) {
      Alert.alert("Error", getFriendlyAuthError(e));
    } finally {
      setChecking(false);
    }
  };

  /* ================= RESEND EMAIL ================= */

  const resendVerification = async () => {
    const user = auth.currentUser;
    if (!user) {
      Alert.alert("Not signed in", "Please sign in again");
      return;
    }
    if (cooldown > 0) return;

    setResendLoading(true);
    try {
      await sendEmailVerification(user);
      Alert.alert("Sent", "Verification email sent");
      setCooldown(30);
    } catch (e) {
      Alert.alert("Error", getFriendlyAuthError(e));
    } finally {
      setResendLoading(false);
    }
  };

  /* ================= LOGOUT / BACK ================= */

  const goBack = async () => {
    try {
      await signOut(auth);
      navigation.reset({
        index: 0,
        routes: [{ name: "Login" }],
      });
    } catch (e) {
      Alert.alert("Error", getFriendlyAuthError(e));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>Email Verification</Text>
        <Text style={styles.subtitle}>
          Click the verification link in your email, then tap below.
        </Text>

        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={checkVerification}
          disabled={checking}
        >
          <Text style={styles.primaryBtnText}>
            {checking ? "Checking..." : "I have verified"}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.secondaryBtn, cooldown ? { opacity: 0.6 } : null]}
          onPress={resendVerification}
          disabled={resendLoading || cooldown > 0}
        >
          {resendLoading ? (
            <ActivityIndicator color="#276EF1" />
          ) : (
            <Text style={styles.secondaryBtnText}>
              {cooldown > 0
                ? `Resend available in ${cooldown}s`
                : "Resend verification email"}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Text style={styles.backBtnText}>Back to Login</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

/* ================= STYLES ================= */

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f7f8fb" },
  inner: { padding: 20, justifyContent: "center", flex: 1 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 8 },
  subtitle: { color: "#555", marginBottom: 16 },
  primaryBtn: {
    backgroundColor: "#276EF1",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginBottom: 12
  },
  primaryBtnText: { color: "#fff", fontWeight: "600" },
  secondaryBtn: { alignItems: "center", padding: 10 },
  secondaryBtnText: { color: "#276EF1" },
  backBtn: { alignItems: "center", padding: 12, marginTop: 20 },
  backBtnText: { color: "#666", fontSize: 16 }
});
