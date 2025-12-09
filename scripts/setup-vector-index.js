
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function setupVectorIndex() {
  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB_NAME || 'DocBot';
  const collectionName = process.env.MONGODB_COLLECTION || 'medical_embeddings';

  if (!uri) {
    console.error('Please set MONGODB_URI in your .env.local file');
    process.exit(1);
  }

  const client = new MongoClient(uri);

  try {
    await client.connect();
    console.log('Connected to MongoDB Atlas');

    const db = client.db(dbName);

    // Create the collection if it doesn't exist
    try {
      await db.createCollection(collectionName);
      console.log(`Collection '${collectionName}' created.`);
    } catch (error) {
      // Handle "namespace already exists" as a non-fatal case so the script is idempotent
      if (error && error.code === 48) {
        console.log(`Collection '${collectionName}' already exists, continuing.`);
      } else {
        throw error;
      }
    }

    // Note: Vector search indexes must be created through the MongoDB Atlas UI
    // This script just ensures the collection exists
    console.log('\n=== IMPORTANT: Vector Search Index Setup ===');
    console.log('You need to create a vector search index in MongoDB Atlas UI:');
    console.log('1. Go to your MongoDB Atlas dashboard');
    console.log('2. Navigate to your cluster');
    console.log('3. Go to the "Search" tab');
    console.log('4. Click "Create Index"');
    console.log('5. Select your database and collection');
    console.log('6. Use this JSON configuration:');
    console.log(JSON.stringify({
      "fields": [
        {
          "type": "vector",
          "path": "embedding",
          "numDimensions": 768,
          "similarity": "cosine"
        },
        {
          "type": "filter",
          "path": "metadata.source"
        }
      ]
    }, null, 2));
    console.log('7. Name the index "vector_index"');

  } catch (error) {
    console.error('Error setting up vector index:', error);
  } finally {
    await client.close();
  }
}

setupVectorIndex();
