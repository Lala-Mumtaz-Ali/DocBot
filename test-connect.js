const { MongoClient } = require('mongodb');
require('dotenv').config({ path: '.env.local' });

async function run() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("MONGODB_URI not found");
        return;
    }
    console.log("Testing connection to:", uri.replace(/:([^@]+)@/, ':****@')); // Mask password

    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });

    try {
        await client.connect();
        console.log("Successfully connected to MongoDB!");
        await client.close();
    } catch (err) {
        console.error("Connection failed:", err);
    }
}

run();
