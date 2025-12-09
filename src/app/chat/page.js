'use client';

import { useState, useRef, useEffect } from 'react';
import { FaPaperPlane, FaRobot, FaUser } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';
import styles from '../style/chat.module.css';
import Navbar from '../_components/navbar';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function ChatPage() {
    // State now uses unique IDs for messages
    const [messages, setMessages] = useState([
        {
            id: 'welcome-msg',
            role: 'bot',
            content: 'Hello! I am **DocBot**. \n\nI can help you answer medical questions based on my database. Try asking "What is diabetes?"'
        }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const sendMessage = async (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const timestamp = Date.now();
        const userMessage = { id: `user-${timestamp}`, role: 'user', content: input };

        setMessages((prev) => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: input }),
            });

            if (!response.ok) throw new Error('Failed to fetch response');

            const data = await response.json();

            // Handle bot response
            const botContent = data.reply || "I didn't get a response. Please check the backend.";
            setMessages((prev) => [
                ...prev,
                { id: `bot-${Date.now()}`, role: 'bot', content: botContent }
            ]);

        } catch (error) {
            console.error('Error:', error);
            setMessages((prev) => [
                ...prev,
                { id: `err-${Date.now()}`, role: 'bot', content: '**Error**: I encountered an issue connecting to my brain. Please try again.' }
            ]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', backgroundColor: '#f0f2f5' }}>
            <Navbar />
            <div className={styles.container}>
                <div className={styles.messagesContainer}>
                    <AnimatePresence>
                        {messages.map((msg) => (
                            <motion.div
                                key={msg.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.userMessage : styles.botMessage}`}
                            >
                                <div className={`${styles.avatar} ${msg.role === 'user' ? styles.userAvatar : styles.botAvatar}`}>
                                    {msg.role === 'user' ? <FaUser /> : <FaRobot />}
                                </div>
                                <div className={`${styles.messageContent} ${msg.role === 'user' ? styles.userContent : styles.botContent}`}>
                                    {msg.role === 'bot' ? (
                                        <div className={styles.markdownBody}>
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                {msg.content}
                                            </ReactMarkdown>
                                        </div>
                                    ) : (
                                        msg.content
                                    )}
                                </div>
                            </motion.div>
                        ))}
                    </AnimatePresence>
                    {isLoading && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className={`${styles.messageWrapper} ${styles.botMessage}`}
                        >
                            <div className={`${styles.avatar} ${styles.botAvatar}`}>
                                <FaRobot />
                            </div>
                            <div className={`${styles.messageContent} ${styles.botContent}`}>
                                <div className={styles.loading}>
                                    <div className={styles.dot}></div>
                                    <div className={styles.dot}></div>
                                    <div className={styles.dot}></div>
                                </div>
                            </div>
                        </motion.div>
                    )}
                    <div ref={messagesEndRef} />
                </div>

                <form onSubmit={sendMessage} className={styles.inputArea}>
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="Type a medical question..."
                        className={styles.input}
                        disabled={isLoading}
                    />
                    <button type="submit" className={styles.sendButton} disabled={isLoading || !input.trim()}>
                        <FaPaperPlane />
                    </button>
                </form>
            </div>
        </div>
    );
}
