"use client";

import {
  useEffect,
  useState,
} from "react";

import {
  useRouter,
} from "next/navigation";

import styles
from "../style/complete-profile.module.css";

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

    <div
      className={
        styles.container
      }
    >

      <div
        className={
          styles.card
        }
      >

        <h1
          className={
            styles.title
          }
        >
          Complete Your Profile
        </h1>

        {/* ERROR */}

        {error && (

          <p
            className={
              styles.error
            }
          >
            {error}
          </p>
        )}

        {/* SUCCESS */}

        {success && (

          <p
            className={
              styles.success
            }
          >
            {success}
          </p>
        )}

        {/* NAME */}

        <input
          className={
            styles.input
          }

          value={form.name}

          disabled
        />

        {/* EMAIL */}

        <input
          className={
            styles.input
          }

          value={form.email}

          disabled
        />

        {/* ADDRESS */}

        <input
          className={
            styles.input
          }

          name="address"

          value={
            form.address
          }

          placeholder="Address"

          onChange={
            handleChange
          }
        />

        {/* CITY */}

        <input
          className={
            styles.input
          }

          name="city"

          value={
            form.city
          }

          placeholder="City"

          onChange={
            handleChange
          }
        />

        {/* CONTACT */}

        <input
          className={
            styles.input
          }

          name="contact"

          value={
            form.contact
          }

          placeholder="03XXXXXXXXX"

          onChange={
            handleChange
          }
        />

        {/* ROLE */}

        <select
          className={
            styles.input
          }

          name="role"

          value={
            form.role
          }

          onChange={
            handleChange
          }
        >

          <option value="">
            Select Role
          </option>

          <option value="hospital">
            Hospital
          </option>

          <option value="doctor">
            Doctor
          </option>

          <option value="patient">
            Patient
          </option>

        </select>

        {/* PASSWORD */}

        <input
          className={
            styles.input
          }

          type="password"

          name="password"

          value={
            form.password
          }

          placeholder="Password"

          onChange={
            handleChange
          }
          disabled
        />

        {/* CONFIRM PASSWORD */}

        <input
          className={
            styles.input
          }

          type="password"

          name="confirmPassword"

          value={
            form.confirmPassword
          }

          placeholder="Confirm Password"

          onChange={
            handleChange
          }
          disabled
        />

        {/* BUTTON */}

        <button
          className={
            styles.button
          }

          onClick={
            handleSubmit
          }

          disabled={
            loading
          }
        >

          {loading
            ? "Creating Account..."
            : "Complete Signup"}

        </button>

      </div>
    </div>
  );
}