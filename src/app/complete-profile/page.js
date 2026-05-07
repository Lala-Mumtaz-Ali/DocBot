"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion"; // ✅ HERE
import styles from "../style/complete-profile.module.css";
import Footer from "../_components/aboutus";
import SignNavbar from "../_components/signnavbar";

export default function CompleteProfile() {

  const router =
    useRouter();

  // ============================================
  // STATES
  // ============================================

  const [form, setForm] =
    useState({

      name: "",
      email: "",
      address: "",
      city: "",
      contact: "",
      role: "",
      password: "",
      confirmPassword: "",
    });

  const [error,
    setError] =
    useState("");

  const [success,
    setSuccess] =
    useState("");

  const [loading,
    setLoading] =
    useState(false);

  // ============================================
  // LOAD GOOGLE DATA
  // ============================================

  useEffect(() => {

    const storedData =
      localStorage.getItem(
        "googleSignupData"
      );

    if (!storedData) {

      router.push("/");
      return;
    }

    const data =
      JSON.parse(storedData);

    setForm((prev) => ({
      ...prev,

      name:
        data.name || "",

      email:
        data.email || "",
      password:
        "Docbot@12345678",

      confirmPassword:
        "Docbot@12345678",

    }));

  }, [router]);

  // ============================================
  // HANDLE CHANGE
  // ============================================

  const handleChange =
    (e) => {

      setForm({
        ...form,

        [e.target.name]:
          e.target.value,
      });
    };

  // ============================================
  // HANDLE SUBMIT
  // ============================================

  const handleSubmit =
    async () => {

      setError("");
      setSuccess("");

      // REQUIRED FIELDS

      if (
        !form.address ||
        !form.city ||
        !form.contact ||
        !form.role
      ) {

        setError(
          "⚠️ All fields are required."
        );

        return;
      }

      // PHONE VALIDATION

      if (
        !/^[0-9]{11}$/
          .test(form.contact)
      ) {

        setError(
          "⚠️ Invalid phone number."
        );

        return;
      }

      // PASSWORD LENGTH

      if (
        form.password.length < 6
      ) {

        setError(
          "⚠️ Password must be at least 6 characters."
        );

        return;
      }

      // PASSWORD MATCH

      if (
        form.password !==
        form.confirmPassword
      ) {

        setError(
          "⚠️ Passwords do not match."
        );

        return;
      }

      try {

        setLoading(true);

        const res =
          await fetch(
            "/api/complete-google-signup",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({

                ...form,

                isGoogleUser: true,
              }),
            }
          );

        const data =
          await res.json();

        // ERROR

        if (!data.success) {

          setError(
            data.message ||
            "Signup Failed"
          );

          setLoading(false);

          return;
        }

        // SAVE USER

        localStorage.setItem(
          "user",

          JSON.stringify(
            data.user
          )
        );

        localStorage.setItem(
          "token",
          data.token
        );

        // REMOVE TEMP DATA

        localStorage.removeItem(
          "googleSignupData"
        );

        // SUCCESS

        setSuccess(
          "🎉 Account Created Successfully!"
        );

        setLoading(false);

        // REDIRECT

        setTimeout(() => {

          router.push(
            "/profile"
          );

        }, 1500);

      } catch (error) {

        console.log(error);

        setLoading(false);

        setError(
          "❌ Server Error"
        );
      }
    };

  // ============================================
  // UI
  // ============================================

return (
  <>
  <SignNavbar />
  <div className={styles.container}>
    <motion.div
      className={styles.card}
      initial={{ opacity: 0, y: 40, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className={styles.title}>
        Complete Your Profile
      </h1>

      {error && (
        <motion.p
          className={styles.error}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {error}
        </motion.p>
      )}

      {success && (
        <motion.p
          className={styles.success}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          {success}
        </motion.p>
      )}

      {/* Floating Inputs */}

      <div className={styles.group}>
        <input value={form.name} disabled />
      </div>

      <div className={styles.group}>
        <input value={form.email} disabled />
      </div>

      <div className={styles.group}>
        <input
          name="address"
          value={form.address}
          onChange={handleChange}
          required
          placeholder="Address"
        />
      </div>

      <div className={styles.group}>
        <input
          name="city"
          value={form.city}
          onChange={handleChange}
          required
          placeholder="City"
        />
      </div>

      <div className={styles.group}>
        <input
          name="contact"
          value={form.contact}
          onChange={handleChange}
          required
          placeholder="03XXXXXXXXX"
        />
      </div>

      {/* Role */}
      <select
        className={styles.select}
        name="role"
        value={form.role}
        onChange={handleChange}
      >
        <option value="">Select Role</option>
        <option value="hospital">🏥 Hospital</option>
        <option value="doctor">👨‍⚕️ Doctor</option>
        <option value="patient">🧑 Patient</option>
      </select>

      <motion.button
        whileTap={{ scale: 0.95 }}
        className={styles.button}
        onClick={handleSubmit}
        disabled={loading}
      >
        {loading ? "Creating..." : "Complete Signup"}
      </motion.button>
    </motion.div>
  </div>
  <Footer  />
  </>
);
}