'use client';

import { useEffect, useState } from "react";
import Signin from "./_components/signin";
import Signup from "./_components/signup";
import styles from "./page.module.css";
import SignNavbar from "./_components/signnavbar";
import Footer from "./_components/aboutus";
import { motion } from "framer-motion";
export default function Home() {
  const [loaded, setLoaded] = useState(false);
  const [login, setLogin] = useState(true); // default: show Signin page

  useEffect(() => {
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  return (
    <div className={styles.homeContainer}>
      {/* ✅ Navbar always visible */}
      <SignNavbar />

      {/* ✅ Auth Section */}
      <motion.div
  className={styles.homeContainer}
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ duration: 0.6 }}
>
  {/* everything */}
      <div className={styles.authSection}>
        {login ? <Signin /> : <Signup />}

        {/* ✅ Toggle between Signin & Signup */}
        <div className={styles.switchContainer}>
          {login ? (
            <p>
              Don’t have an account?{" "}
              <span
                onClick={() => setLogin(false)}
                className={styles.switchLink}
                >
                Sign up here
              </span>
            </p>
          ) : (
            <p>
              Already have an account?{" "}
              <span
                onClick={() => setLogin(true)}
                className={styles.switchLink}
                >
                Sign in here
              </span>
            </p>
          )}
        </div>
      </div>
          </motion.div>
      <Footer />
    </div>
  );
}
