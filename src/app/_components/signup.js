"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import {
  motion,
  AnimatePresence,
} from "framer-motion";

import {
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { GoogleLogin }
from "@react-oauth/google";

import styles
from "../style/sign.module.css";

const Signup = () => {

  const router = useRouter();

  // ============================================
  // STATES
  // ============================================

  const [errorMsg, setErrorMsg] =
    useState("");

  const [successMsg, setSuccessMsg] =
    useState("");

  const [isGoogleUser,
    setIsGoogleUser] =
    useState(false);

  const [name, setName] =
    useState("");

  const [email, setEmail] =
    useState("");

  const [address, setAddress] =
    useState("");

  const [city, setCity] =
    useState("");

  const [role, setRole] =
    useState("");

  const [contact, setContact] =
    useState("");

  const [password, setPassword] =
    useState("");

  const [
    confirmPassword,
    setConfirmPassword,
  ] = useState("");

  const [showPassword,
    setShowPassword] =
    useState(false);

  const [
    showConfirmPassword,
    setShowConfirmPassword,
  ] = useState(false);

  // ============================================
  // VALIDATIONS
  // ============================================

  const validateEmail =
    (email) => {

      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);
    };

  const validatePhone =
    (phone) => {

      return /^[0-9]{11}$/
        .test(phone);
    };

  // ============================================
  // SIGNUP
  // ============================================

  const handleSignup =
    async () => {

      setErrorMsg("");
      setSuccessMsg("");

      // REQUIRED FIELDS

      if (
        !name ||
        !email ||
        !address ||
        !city ||
        !role ||
        !contact
      ) {

        setErrorMsg(
          "⚠️ All fields are required."
        );

        return;
      }

      // PASSWORD REQUIRED FOR NORMAL USERS

      if (
        !isGoogleUser &&
        (!password ||
          !confirmPassword)
      ) {

        setErrorMsg(
          "⚠️ Password is required."
        );

        return;
      }

      // EMAIL VALIDATION

      if (
        !validateEmail(email)
      ) {

        setErrorMsg(
          "⚠️ Invalid email."
        );

        return;
      }

      // PHONE VALIDATION

      if (
        !validatePhone(contact)
      ) {

        setErrorMsg(
          "⚠️ Invalid phone number."
        );

        return;
      }

      // PASSWORD MATCH

      if (
        !isGoogleUser &&
        password !==
          confirmPassword
      ) {

        setErrorMsg(
          "⚠️ Passwords do not match."
        );

        return;
      }

      try {

        const res =
          await fetch(
            "/api/sign",
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                name,
                email,
                address,
                city,
                role,
                contact,

                password:
                  isGoogleUser
                    ? null
                    : password,

                isGoogleUser,
              }),
            }
          );

        const data =
          await res.json();

        if (
          !res.ok ||
          !data.success
        ) {

          setErrorMsg(
            data.message ||
              "Signup Failed"
          );

          return;
        }

        // SUCCESS

        setSuccessMsg(
          "✅ Account Created Successfully!"
        );

        // RESET

        setName("");
        setEmail("");
        setAddress("");
        setCity("");
        setRole("");
        setContact("");
        setPassword("");
        setConfirmPassword("");
        setIsGoogleUser(false);

        setTimeout(() => {

          router.push(
            "/"
          );

        }, 1500);

      } catch (error) {

        console.log(error);

        setErrorMsg(
          "❌ Server Error"
        );
      }
    };

  // ============================================
  // GOOGLE SIGNUP
  // ============================================

  // ============================================
// GOOGLE SIGNUP
// ============================================

const handleGoogleSignup =
  async (credentialResponse) => {

    try {

      const res =
        await fetch(
          "/api/google-login",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              token:
                credentialResponse.credential,
            }),
          }
        );

      const data =
        await res.json();

      // ====================================
      // USER ALREADY EXISTS
      // ====================================

      if (!data.isNewUser) {

        setErrorMsg(
          "⚠️ Account already exists. Please login."
        );

        setTimeout(() => {

          router.push(
            "/"
          );

        }, 1500);

        return;
      }

      // ====================================
      // NEW GOOGLE USER
      // ====================================

      // SAVE GOOGLE DATA

      localStorage.setItem(
        "googleSignupData",

        JSON.stringify({
          name:
            data.googleData.name,

          email:
            data.googleData.email,

        })
      );

      setSuccessMsg(
        "✅ Google verified. Complete your profile."
      );

      // REDIRECT TO COMPLETE PROFILE

      setTimeout(() => {

        router.push(
          "/complete-profile"
        );

      }, 1500);

    } catch (error) {

      console.log(error);

      setErrorMsg(
        "❌ Google Signup Failed"
      );
    }
  };

  return (

    <div className={styles.signup}>

      {/* IMAGE */}

      <div
        className={
          styles.signupImg
        }
      ></div>

      {/* FORM */}

      <div
        className={
          styles.signupForm
        }
      >

        <h1>
          DocBot Sign Up
        </h1>

        {/* ALERTS */}

        <AnimatePresence>

          {errorMsg && (

            <motion.div
              className={`${styles.alertBox} ${styles.errorBox}`}

              initial={{
                opacity: 0,
                y: -10,
              }}

              animate={{
                opacity: 1,
                y: 0,
              }}

              exit={{
                opacity: 0,
                y: -10,
              }}
            >

              <AlertCircle />

              <span>
                {errorMsg}
              </span>

            </motion.div>
          )}

          {successMsg && (

            <motion.div
              className={`${styles.alertBox} ${styles.successBox}`}

              initial={{
                opacity: 0,
                y: -10,
              }}

              animate={{
                opacity: 1,
                y: 0,
              }}

              exit={{
                opacity: 0,
                y: -10,
              }}
            >

              <CheckCircle2 />

              <span>
                {successMsg}
              </span>

            </motion.div>
          )}

        </AnimatePresence>

        {/* INPUTS */}

        <div
          className={
            styles.inputWrapper
          }
        >

          {/* NAME */}

          <input
            className={
              styles.signupInput
            }

            type="text"

            value={name}

            onChange={(e) =>
              setName(
                e.target.value
              )
            }

            placeholder="Enter Name"
          />

          {/* EMAIL */}

          <input
            className={
              styles.signupInput
            }

            type="email"

            value={email}

            onChange={(e) =>
              setEmail(
                e.target.value
              )
            }

            placeholder="Enter Email"

            disabled={
              isGoogleUser
            }
          />

          {/* ADDRESS */}

          <input
            className={
              styles.signupInput
            }

            type="text"

            value={address}

            onChange={(e) =>
              setAddress(
                e.target.value
              )
            }

            placeholder="Enter Address"
          />

          {/* CITY */}

          <input
            className={
              styles.signupInput
            }

            type="text"

            value={city}

            onChange={(e) =>
              setCity(
                e.target.value
              )
            }

            placeholder="Enter City"
          />

          {/* CONTACT */}

          <input
            className={
              styles.signupInput
            }

            type="text"

            value={contact}

            onChange={(e) =>
              setContact(
                e.target.value
              )
            }

            placeholder="03XXXXXXXXX"
          />

          {/* ROLE */}

          <select
            className={
              styles.signupInput
            }

            value={role}

            onChange={(e) =>
              setRole(
                e.target.value
              )
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

          <div
            style={{
              position:
                "relative",
            }}
          >

            <input
              className={
                styles.signupInput
              }

              type={
                showPassword
                  ? "text"
                  : "password"
              }

              value={password}

              onChange={(e) =>
                setPassword(
                  e.target.value
                )
              }

              placeholder="Password"

              disabled={
                isGoogleUser
              }
            />

            <span
              onClick={() =>
                setShowPassword(
                  !showPassword
                )
              }

              className={
                styles.togglePasswordIcon
              }
            >
              {showPassword
                ? "🙈"
                : "👁️"}
            </span>

          </div>

          {/* CONFIRM PASSWORD */}

          <div
            style={{
              position:
                "relative",
            }}
          >

            <input
              className={
                styles.signupInput
              }

              type={
                showConfirmPassword
                  ? "text"
                  : "password"
              }

              value={
                confirmPassword
              }

              onChange={(e) =>
                setConfirmPassword(
                  e.target.value
                )
              }

              placeholder="Confirm Password"

              disabled={
                isGoogleUser
              }
            />

            <span
              onClick={() =>
                setShowConfirmPassword(
                  !showConfirmPassword
                )
              }

              className={
                styles.togglePasswordIcon
              }
            >
              {showConfirmPassword
                ? "🙈"
                : "👁️"}
            </span>

          </div>

        </div>

        {/* REGISTER BUTTON */}

        <button
          className={
            styles.loginButton
          }

          onClick={
            handleSignup
          }
        >
          Register
        </button>

        {/* DIVIDER */}

        <div
          style={{
            margin: "20px 0",
            textAlign: "center",
            color: "#999",
          }}
        >
          OR
        </div>

        {/* GOOGLE SIGNUP */}

        <div
          style={{
            display: "flex",
            justifyContent:
              "center",
          }}
        >

          <GoogleLogin
            onSuccess={
              handleGoogleSignup
            }

            onError={() =>
              setErrorMsg(
                "❌ Google Signup Failed"
              )
            }
             text="signup_with"
              shape="pill"
              theme="filled_blue"
              size="large"
          />

        </div>

      </div>
    </div>
  );
};

export default Signup;