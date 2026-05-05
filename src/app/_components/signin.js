
'use client';

import styles from "../style/sign.module.css";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

import { GoogleLogin } from "@react-oauth/google";

const Signin = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] =
    useState("");

  const [alert, setAlert] = useState({
    type: "",
    message: "",
  });

  const router = useRouter();

  // =========================
  // NORMAL LOGIN
  // =========================
  const handleSignin = async () => {
    setAlert({
      type: "",
      message: "",
    });

    if (!email || !password) {
      setAlert({
        type: "error",
        message:
          "⚠️ Please fill in both email and password.",
      });

      return;
    }

    try {
      const res = await fetch("/api/sign", {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          email,
          password,
          login: true,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setAlert({
          type: "error",
          message:
            data.message ||
            "❌ Invalid username or password.",
        });

        return;
      }

      const { result, token } = data;

      if (result)
        delete result.password;

      localStorage.setItem(
        "user",
        JSON.stringify(result)
      );

      localStorage.setItem(
        "token",
        token
      );

      setAlert({
        type: "success",
        message:
          "🎉 Login successful! Redirecting...",
      });

      setTimeout(() => {
        router.push("/profile");
      }, 1500);

    } catch (error) {
      console.error(
        "Login Error:",
        error
      );

      setAlert({
        type: "error",
        message:
          "❌ Something went wrong.",
      });
    }
  };

  // =========================
  // GOOGLE LOGIN
  // =========================
  // =========================
// GOOGLE LOGIN
// =========================

const handleGoogleSuccess =
  async (credentialResponse) => {

    try {

      const res = await fetch(
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

      const data = await res.json();
      // ====================================
      // USER NOT FOUND
      // ====================================

      if (data.isNewUser) {

        setAlert({
          type: "error",
          message:
            "⚠️ Account not found. Please signup first.",
        });

        setTimeout(() => {

          router.push("/");

        }, 1500);

        return;
      }

      // ====================================
      // LOGIN SUCCESS
      // ====================================

      localStorage.setItem(
        "user",
        JSON.stringify(data.user)
      );

      localStorage.setItem(
        "token",
        data.token
      );

      setAlert({
        type: "success",
        message:
          "🎉 Google Login Successful!",
      });

      setTimeout(() => {

        router.push("/profile");

      }, 1500);

    } catch (error) {

      console.log(error);

      setAlert({
        type: "error",
        message:
          "❌ Google Login Failed",
      });
    }
  };

  return (
    <div className={styles.signup}>
      <div className={styles.signinForm}>
        <h1>DocBot Sign In</h1>

        {/* ALERT */}
        <AnimatePresence>
          {alert.message && (
            <motion.div
              key="alert"
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
              transition={{
                duration: 0.3,
              }}
              className={`${
                styles.alertBox
              } ${
                alert.type === "error"
                  ? styles.errorBox
                  : styles.successBox
              }`}
            >
              {alert.type ===
              "error" ? (
                <AlertCircle size={18} />
              ) : (
                <CheckCircle2 size={18} />
              )}

              <span>
                {alert.message}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* INPUTS */}
        <div className={styles.inputWrapper}>
          <input
            type="email"
            value={email}
            onChange={(e) =>
              setEmail(e.target.value)
            }
            className={
              styles.signupInput
            }
            placeholder="Enter Your Email"
            required
          />

          <input
            type="password"
            value={password}
            onChange={(e) =>
              setPassword(
                e.target.value
              )
            }
            className={
              styles.signupInput
            }
            placeholder="Enter Your Password"
            required
          />
        </div>

        {/* NORMAL LOGIN BUTTON */}
        <button
          onClick={handleSignin}
          disabled={
            !email || !password
          }
          className={
            styles.loginButton
          }
        >
          Log In
        </button>

        {/* DIVIDER */}
        <div
          style={{
            margin: "20px 0",
            textAlign: "center",
            color: "#999",
            fontWeight: "600",
          }}
        >
          OR
        </div>

        {/* GOOGLE LOGIN */}
        <div
          style={{
            display: "flex",
            justifyContent:
              "center",
          }}
        >
          <GoogleLogin
            onSuccess={
              handleGoogleSuccess
            }
            onError={() =>
              setAlert({
                type: "error",
                message:
                  "Google Login Failed",
              })
            }
             //text="signup_with"
            shape="pill"
            theme="filled_blue"
            size="large"
          />
        </div>
      </div>

      <div
        className={styles.signinImg}
      ></div>
    </div>
  );
};

export default Signin;