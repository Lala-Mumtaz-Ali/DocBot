
"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertCircle, CheckCircle2 } from "lucide-react";
import styles from "../style/sign.module.css"; // ✅ Make sure this file exists

const Signup = () => {
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [passwordError, setPasswordError] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [role, setRole] = useState("");
  const [contact, setContact] = useState(""); // ✅ Added contact field
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const handleSignup = async () => {
    setErrorMsg("");
    setSuccessMsg("");

    // ✅ Field validation
    if (!name || !email || !address || !city || !role || !contact || !password || !confirmPassword) {
      setErrorMsg("⚠️ All fields are required.");
      return;
    }

    // ✅ Password length check
    if (password.length < 8) {
      setErrorMsg("⚠️ Password must be at least 8 characters long.");
      return;
    }

    // ✅ Password match check
    if (password !== confirmPassword) {
      setPasswordError(true);
      setErrorMsg("⚠️ Passwords must match.");
      return;
    } else {
      setPasswordError(false);
    }

    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, address, city, role, contact, password }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        if (res.status === 409) {
          setErrorMsg("⚠️ This email is already registered.");
        } else if (res.status === 400) {
          setErrorMsg("⚠️ Please fill in all required fields correctly.");
        } else {
          setErrorMsg(data.message || "❌ Signup failed. Try again later.");
        }
        return;
      }

      // ✅ Success
      const { result, token } = data;
      // localStorage.setItem("User", JSON.stringify(result));
      // localStorage.setItem("Token", token);

      setSuccessMsg("✅ Account created successfully!");
      setName("");
      setEmail("");
      setAddress("");
      setCity("");
      setRole("");
      setContact("");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      console.error("Signup error:", err);
      setErrorMsg("❌ Network or server error occurred.");
    }
  };

  return (
    <div className={styles.signup}>
      <div className={styles.signupImg}></div>

      <div className={styles.signupForm}>
        <h1>DocBot Sign Up</h1>

        {/* ✨ Animated error/success messages */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              className={`${styles.alertBox} ${styles.errorBox}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <AlertCircle className={styles.alertIcon} />
              <span>{errorMsg}</span>
            </motion.div>
          )}

          {successMsg && (
            <motion.div
              className={`${styles.alertBox} ${styles.successBox}`}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <CheckCircle2 className={styles.alertIcon} />
              <span>{successMsg}</span>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.inputWrapper}>
          {/* Name */}
          <input
            className={styles.signupInput}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter Your Name"
            required
          />

          {/* Email */}
          <input
            className={styles.signupInput}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter Your Email"
            required
          />

          {/* Address */}
          <input
            className={styles.signupInput}
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Enter Your Address"
            required
          />

          {/* City */}
          <input
            className={styles.signupInput}
            type="text"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Enter Your City"
            required
          />

          {/* Contact */}
          <input
            className={styles.signupInput}
            type="text"
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="Enter Your Contact Number"
            required
          />

          {/* Role */}
          <select
            className={styles.signupInput}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            required
          >
            <option value="">Select Your Role</option>
            <option value="hospital">Hospital</option>
            <option value="doctor">Doctor</option>
            <option value="patient">Patient</option>
          </select>

          {/* Password */}
          <div style={{ position: "relative", backgroundColor: "white" }}>
            <input
              className={styles.signupInput}
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter Your Password"
              required
            />
            <span
              onClick={() => setShowPassword(!showPassword)}
              className={styles.togglePasswordIcon}
            >
              {showPassword ? "🙈" : "👁️"}
            </span>
          </div>

          {/* Confirm Password */}
          <div style={{ position: "relative", backgroundColor: "white" }}>
            <input
              className={styles.signupInput}
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm Your Password"
              required
            />
            <span
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className={styles.togglePasswordIcon}
            >
              {showConfirmPassword ? "🙈" : "👁️"}
            </span>
          </div>
        </div>

        <button
          className={styles.loginButton}
          onClick={handleSignup}
          disabled={!name || !email || !address || !city || !role || !contact || !password || !confirmPassword}
        >
          Register
        </button>
      </div>
    </div>
  );
};

export default Signup;
