"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  FaRobot,
  FaUser,
  FaList,
  FaChartPie,
  FaSignOutAlt,
  FaBars,
  FaTimes,
} from "react-icons/fa";
import styles from "../style/navbar.module.css";

const Navbar = () => {
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  const menuItems = [
    { id: "Profile", icon: <FaUser />, path: "/profile" },
    { id: "Chatbot", icon: <FaRobot />, path: "/chat" },
    { id: "Record", icon: <FaList />, path: "/record" },
    { id: "Record Summary", icon: <FaChartPie />, path: "/" },
    { id: "Logout", icon: <FaSignOutAlt />, path: "/logout" },
  ];

  const handleNavigation = (path) => {
    router.push(path);
    setMenuOpen(false); // close menu after clicking
  };

  return (
    <header className={styles.navbar}>
      <div className={styles.navbarBrand}>DocBot</div>

      {/* Hamburger Icon (Mobile) */}
      <button
        className={styles.hamburger}
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-label="Toggle menu"
      >
        {menuOpen ? <FaTimes /> : <FaBars />}
      </button>

      {/* Navigation Menu */}
      <nav
        className={`${styles.navMenu} ${menuOpen ? styles.open : ""}`}
      >
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => handleNavigation(item.path)}
            className={`${styles.navItem} ${pathname === item.path ? styles.active : ""
              }`}
          >
            {item.icon}
            <span>{item.id}</span>
          </button>
        ))}
      </nav>
    </header>
  );
};

export default Navbar;
