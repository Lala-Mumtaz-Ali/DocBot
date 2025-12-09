'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Navbar from '../_components/navbar'
import RecordItem from '../_components/record'
import Footer from '../_components/aboutus'

const RecordPage = () => {
  const [isMounted, setIsMounted] = useState(false)
  const router = useRouter()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  useEffect(() => {
    if (!isMounted) return
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    if (!token) {
      router.push('/')
    }
  }, [isMounted, router])

  if (!isMounted) {
    return <div>Loading...</div>
  }

  return (
    <>
      <Navbar />
      <RecordItem />
      <Footer />
    </>
  )
}

export default RecordPage
