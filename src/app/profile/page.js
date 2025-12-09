"use client";  // ✅ Use double quotes (standard), and ensure it's the first line

import { useEffect, useState } from "react";  // ✅ Add useState for mounting check
import { useRouter } from "next/navigation";  // ✅ Fix: Use next/navigation (not next/router) for App Router
import Footer from "../_components/aboutus";
import Navbar from "../_components/navbar";
import Profile from "../_components/profile";
// import Router, { useRouter } from "next/router";  // ❌ Remove this line (not needed)

const page = () => {
  const [isMounted, setIsMounted] = useState(false);  // ✅ Add mounted check to fix "NextRouter was not mounted"
  const router = useRouter();

  // ✅ Set mounted flag after component mounts
  useEffect(() => {
    setIsMounted(true);
  }, []);

  // ✅ Move authentication check inside a mounted check
  useEffect(() => {
    if (!isMounted) return;  // ✅ Prevent running before mount
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;  // ✅ Fix typo: "undefined" not ""
    if (!token) {
      router.push('/');  // Redirect to login (or /login) if no token
    }
  }, [isMounted, router]);  // ✅ Depend on isMounted and router

  // ✅ Prevent rendering until mounted (optional, but helps avoid errors/flashes)
  if (!isMounted) {
    return <div>Loading...</div>;  // Or null, or a spinner
  }

  return (
    <>
      <Navbar />
      <Profile />
      <Footer />
    </>
  );
};

export default page;
