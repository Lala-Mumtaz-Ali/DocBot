"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import styles from "../style/logout.module.css"; // ✅ new CSS module

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    // ✅ Clear user data and JWT token (case-insensitive)
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("Token");
    localStorage.removeItem("User");

    // ✅ Redirect to home
    setTimeout(() => {
      router.push("/");
    }, 1500);
  }, [router]);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Logging you out...</h1>
        <p className={styles.text}>
          Please wait while we securely redirect you to the home page.
        </p>
        <div className={styles.loader}></div>
      </div>
    </div>
  );
}
