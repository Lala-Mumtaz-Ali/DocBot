'use client';

import styles from "../style/sign.module.css";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle2 } from "lucide-react";

const Signin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [alert, setAlert] = useState({ type: "", message: "" });
  const router = useRouter();

  const handleSignin = async () => {
    setAlert({ type: "", message: "" });

    if (!email || !password) {
      setAlert({
        type: "error",
        message: "⚠️ Please fill in both email and password.",
      });
      return;
    }

    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, login: true }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setAlert({
          type: "error",
          message: data.message || "❌ Invalid username or password.",
        });
        return;
      }

      // ✅ Successful login
      const { result, token } = data;
      if (result) delete result.password;
      localStorage.setItem("user", JSON.stringify(result));
      localStorage.setItem("token", token);

      setAlert({
        type: "success",
        message: "🎉 Login successful! Redirecting to your profile...",
      });

      setTimeout(() => router.push("/profile"), 1500);
    } catch (error) {
      console.error("Login Error:", error);
      setAlert({
        type: "error",
        message: "❌ Something went wrong. Please try again later.",
      });
    }
  };

  return (
    <div className={styles.signup}>
      <div className={styles.signinForm}>
        <h1>DocBot Sign In</h1>

        {/* 🌟 Animated Error / Success Alert */}
        <AnimatePresence>
          {alert.message && (
            <motion.div
              key="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
              className={`${styles.alertBox} ${
                alert.type === "error" ? styles.errorBox : styles.successBox
              }`}
            >
              {alert.type === "error" ? (
                <AlertCircle size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}
              <span>{alert.message}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.inputWrapper}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.signupInput}
            placeholder="Enter Your Email"
            required
          />

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={styles.signupInput}
            placeholder="Enter Your Password"
            required
          />
        </div>

        <button
          onClick={handleSignin}
          disabled={!email || !password}
          className={styles.loginButton}
        >
          Log In
        </button>
      </div>

      <div className={styles.signinImg}></div>
    </div>
  );
};

export default Signin;
