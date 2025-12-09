'use client';

import {
  FaTwitter,
  FaFacebookF,
  FaInstagram,
  FaLinkedinIn,
  FaPhoneAlt,
  FaEnvelope,
  FaMapMarkerAlt,
} from "react-icons/fa";
import styles from "../style/aboutus.module.css";

const Footer = () => {
  return (
    <footer className={styles.footer} id="footer">
      <div className={styles.container}>

        <div className={styles.aboutSection}>
          <h3 className={styles.title}>About DocBot</h3>
          <p className={styles.text}>
            DocBot helps you navigate healthcare seamlessly with AI-powered solutions,
            connecting patients, doctors, and hospitals in one trusted platform.
          </p>
          <div className={styles.socialIconsCentered}>
            <a href="https://twitter.com" target="_blank" rel="noopener noreferrer" aria-label="Twitter">
              <FaTwitter />
            </a>
            <a href="https://facebook.com" target="_blank" rel="noopener noreferrer" aria-label="Facebook">
              <FaFacebookF />
            </a>
            <a href="https://instagram.com" target="_blank" rel="noopener noreferrer" aria-label="Instagram">
              <FaInstagram />
            </a>
            <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer" aria-label="LinkedIn">
              <FaLinkedinIn />
            </a>
          </div>
        </div>

        <div className={styles.servicesSection}>
          <h3 className={styles.title}>Our Services</h3>
          <ul className={styles.linkList}>
            <li>AI Chatbot Support</li>
            <li>Medical Record Management</li>
            <li>Doctor & Hospital Directory</li>
            <li>Health Analytics & Reports</li>
          </ul>
        </div>

        <div className={styles.contactSection}>
          <h3 className={styles.title}>Contact Us</h3>
          <ul className={styles.contactList}>
            <li>
              <FaMapMarkerAlt className={styles.icon} />
              <a>Fast Nuces Karachi</a>
            </li>
            <li>
              <FaPhoneAlt className={styles.icon} />
              <a href="03151357817">+92 3151357817</a>
            </li>
            <li>
              <FaEnvelope className={styles.icon} />
              <a href="zainulabidinkhanxada@gmail.com">admin@gmail.com</a>
            </li>
          </ul>
        </div>

      </div>

      <div className={styles.copyRight}>
        &copy; {new Date().getFullYear()} DocBot. All rights reserved.
      </div>
    </footer>
  );
};

export default Footer;
