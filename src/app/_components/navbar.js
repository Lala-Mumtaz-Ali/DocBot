"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FaRobot,
  FaUser,
  FaList,
  FaInbox,
  FaChartPie,
  FaSignOutAlt,
  FaBars,
  FaTimes,
  FaChevronDown,
} from "react-icons/fa";
import styles from "../style/navbar.module.css";

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();

  const [menuOpen, setMenuOpen] = useState(false);
  const [recordOpen, setRecordOpen] = useState(false);

  const handleNavigation = (path) => {
    router.push(path);
    setMenuOpen(false);
    setRecordOpen(false);
  };

  return (
    <header className={styles.navbar}>
      <div className={styles.navbarBrand}>DocBot</div>

      {/* Hamburger (Mobile) */}
      <button
        className={styles.hamburger}
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label="Toggle menu"
      >
        {menuOpen ? <FaTimes /> : <FaBars />}
      </button>

      {/* Menu */}
      <nav className={`${styles.navMenu} ${menuOpen ? styles.open : ""}`}>
        {/* Profile */}
        <button
          onClick={() => handleNavigation("/profile")}
          className={`${styles.navItem} ${
            pathname === "/profile" ? styles.active : ""
          }`}
        >
          <FaUser />
          <span>Profile</span>
        </button>

        {/* Chatbot */}
        <button
          onClick={() => handleNavigation("/chat")}
          className={`${styles.navItem} ${
            pathname === "/chat" ? styles.active : ""
          }`}
        >
          <FaRobot />
          <span>Chatbot</span>
        </button>

        {/* RECORD DROPDOWN */}
        <div className={styles.dropdownWrapper}>
          <button
            onClick={() => setRecordOpen((prev) => !prev)}
            className={`${styles.navItem} ${
              pathname.startsWith("/record") || pathname === "/inbox"
                ? styles.active
                : ""
            }`}
          >
            <FaList />
            <span>Record</span>
            <FaChevronDown
              className={`${styles.chevron} ${
                recordOpen ? styles.rotate : ""
              }`}
            />
          </button>

          {recordOpen && (
            <div className={styles.dropdownMenu}>
              <button
                onClick={() => handleNavigation("/record")}
                className={`${styles.dropdownItem} ${
                  pathname === "/record" ? styles.active : ""
                }`}
              >
                <FaList />
                Records
              </button>

              <button
                onClick={() => handleNavigation("/inbox")}
                className={`${styles.dropdownItem} ${
                  pathname === "/inbox" ? styles.active : ""
                }`}
              >
                <FaInbox />
                Inbox
              </button>
            </div>
          )}
        </div>

        {/* Record Summary */}
        <button
          onClick={() => handleNavigation("/record-summary")}
          className={`${styles.navItem} ${
            pathname === "/record-summary" ? styles.active : ""
          }`}
        >
          <FaChartPie />
          <span>Record Summary</span>
        </button>

        {/* Logout */}
        <button
          onClick={() => handleNavigation("/logout")}
          className={styles.navItem}
        >
          <FaSignOutAlt />
          <span>Logout</span>
        </button>
      </nav>
    </header>
  );
};

export default Navbar;
