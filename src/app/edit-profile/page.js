
'use client';

import { useEffect, useState } from 'react';
import styles from '../style/edit-profile.module.css';
import Navbar from '../_components/navbar';
import Footer from '../_components/aboutus';
import { useRouter } from 'next/navigation'; // ✅ Use next/navigation for App Router

export default function EditProfile() {
    const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    address: '',
    city: '',
    contact: '',
  });

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState('');

  // ================= LOAD USER DATA =================

  useEffect(() => {

    const user =
      JSON.parse(
        localStorage.getItem('user')
      );
    if(!user){
        router.push('/'); // Redirect to home if no user data
        return;
    }

    if (user) {

      setForm({
        name:
          user.name || '',

        email:
          user.email || '',

        address:
          user.address || '',

        city:
          user.city || '',

        contact:
          user.contact || '',
      });
    }

  }, []);

  // ================= HANDLE CHANGE =================

  const handleChange = (e) => {

    setForm({
      ...form,

      [e.target.name]:
        e.target.value,
    });
  };

  // ================= SAVE =================

  const handleSave = async () => {

    setLoading(true);

    setMessage('');

    try {

      const res =
        await fetch(
          '/api/update-profile',
          {
            method: 'PUT',

            headers: {
              'Content-Type':
                'application/json',
            },

            body:
              JSON.stringify(form),
          }
        );

      const data =
        await res.json();

      // ERROR

      if (!data.success) {

        setMessage(
          '❌ Update failed'
        );

        setLoading(false);

        return;
      }

      // UPDATE LOCAL STORAGE

      localStorage.setItem(
        'user',

        JSON.stringify(
          data.user
        )
      );

      // SUCCESS

      setMessage(
        '✅ Profile updated successfully'
      );
      router.push('/profile'); // Redirect to profile page after successful update

    } catch (err) {

      console.log(err);

      setMessage(
        '❌ Server error'
      );
    }

    setLoading(false);
  };

  return (

    <div>

      <Navbar />

      <div className={styles.container}>

        <div className={styles.card}>

          <h1 className={styles.title}>
            Edit Profile
          </h1>

          {message && (

            <p className={styles.message}>
              {message}
            </p>
          )}

          {/* NAME */}

          <input
            className={styles.input}

            name="name"

            value={form.name}

            onChange={handleChange}

            placeholder="Name"
          />

          {/* EMAIL */}

          <input
            className={styles.input}

            name="email"

            value={form.email}

            disabled

            placeholder="Email"
          />

          {/* ADDRESS */}

          <input
            className={styles.input}

            name="address"

            value={form.address}

            onChange={handleChange}

            placeholder="Address"
          />

          {/* CITY */}

          <input
            className={styles.input}

            name="city"

            value={form.city}

            onChange={handleChange}

            placeholder="City"
          />

          {/* CONTACT */}

          <input
            className={styles.input}

            name="contact"

            value={form.contact}

            onChange={handleChange}

            placeholder="Phone Number"
          />

          {/* BUTTON */}

          <button
            className={styles.button}

            onClick={handleSave}

            disabled={loading}
          >

            {loading
              ? "Saving..."
              : "Save Changes"}

          </button>

        </div>

      </div>

      <Footer />

    </div>
  );
}