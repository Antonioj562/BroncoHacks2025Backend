import 'dotenv/config';
import { clerkClient, requireAuth, getAuth } from '@clerk/express'

// const userId = 'user_123'

const activeUser = await clerkClient.users.getUser(userId)

const express = require('express');
const { MongoClient, ServerApiVersion } = require('mongodb');
const app = express();
app.use(clerkMiddleware())
app.use(express.json());

const uri = `mongodb+srv://antoniojloyola:${process.env.DB_PASSWORD}@moodcluster.wmce0nu.mongodb.net/?retryWrites=true&w=majority&appName=MoodCluster`;

const client = new MongoClient(uri, {
	serverApi: {
		version: ServerApiVersion.v1,
		strict: true,
		deprecationErrors: true,
	}
});

let moodsCollection;

async function connectDB() {
	try {
		await client.connect();
		await client.db("admin").command({ ping: 1 });
		console.log("Pinged your deployment. Connected to MongoDB!");

		// Set your collection
		const db = client.db('MoodData'); // <--- Your DB name
		moodsCollection = db.collection('UserMood'); // <--- Your collection name
	} catch (error) {
		console.error('MongoDB connection failed:', error);
	}
	}
	connectDB();

	// Update: Add a new mood entry to existing user's mood array
	app.post('/add-mood', async (req, res) => {
		const { userId } = req.auth;
		const { mood, date } = req.body;
		console.log('Test User ID:', userId);
		if (!userId) {
			return res.status(401).json({ error: 'Unauthorized' });
		}
		try {
		const result = await moodsCollection.updateOne(
			{ userId },
			{
			$push: {
				mood: {
				date: new Date(date),
				mood: mood
				}
			},
			$inc: { currentStreak: 1 }, 
			},
			{ upsert: true } 
		);
	
		res.status(200).json({ message: 'Mood entry added or updated!', result });
		} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Failed to add mood entry.' });
		}
	});	

	app.get('/mood-history/:userId', async (req, res) => {
		const { userId } = req.params;
	
	try {
		const userDoc = await moodsCollection.findOne({ userId });
	
		if (!userDoc) {
		return res.status(404).json({ error: 'User not found' });
		}
	
		const moodsArray = userDoc.mood.map(moodEntry => moodEntry.mood);
		res.json(moodsArray);
	} catch (error) {
		console.error(error);
		res.status(500).json({ error: 'Failed to fetch mood history' });
	}
	});


const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
