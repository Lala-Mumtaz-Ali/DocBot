'use client';

import { useState } from "react";
import { FaBars, FaTimes } from "react-icons/fa";
import styles from "../style/signnavbar.module.css";

const SignNavbar = () => {
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollToFooter = () => {
    const footer = document.getElementById("footer");
    if (footer) {
      footer.scrollIntoView({ behavior: "smooth" });
    }
    setMenuOpen(false);
  };

  return (
    <header className={styles.navbar}>
      <div className={styles.navbarBrand}>DocBot</div>

      <button
        className={styles.hamburger}
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label="Toggle menu"
      >
        {menuOpen ? <FaTimes /> : <FaBars />}
      </button>

      <nav className={`${styles.navMenu} ${menuOpen ? styles.open : ""}`}>
        <button className={styles.navItem} onClick={scrollToFooter}>
          About Us
        </button>
      </nav>
    </header>
  );
};

export default SignNavbar;
