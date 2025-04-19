import express from 'express';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { clerkClient, requireAuth, clerkMiddleware, getAuth } from '@clerk/express';
import dotenv from 'dotenv/config';
import cors from 'cors';
import axios from 'axios';

const app = express();
const corsOptions = {
    origin: 'http://localhost:5173', 
    methods: ['GET', 'POST', 'PUT', 'DELETE'], 
    allowedHeaders: ['Content-Type', 'Authorization'], 
    credentials: true,  
};

app.use(cors(corsOptions));  // Enable CORS with options
app.use(clerkMiddleware({
	publishableKey: process.env.CLERK_API_KEY,
	secretKey: process.env.CLERK_SECRET_KEY
}));
app.use(express.json());


const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent';

const uri = `mongodb+srv://antoniojloyola:${process.env.DB_PASSWORD}@MoodCluster.wmce0nu.mongodb.net/?retryWrites=true&w=majority&appName=MoodCluster`;

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

        const db = client.db('MoodData'); 
        moodsCollection = db.collection('UserMood'); 
    } catch (error) {
        console.error('MongoDB connection failed:', error);
    }
}

connectDB();

// Update: Add a new mood entry to existing user's mood array
app.post('/add-mood', requireAuth(), async (req, res) => {
    const { userId } = req.auth;
    const { mood, date } = req.body;
    
    console.log('Test User ID:', userId);
    
    if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        // Try to find the user's record
        const userDoc = await moodsCollection.findOne({ userId });

        if (userDoc) {
            // If the user exists, push the new mood and update the streak
            const newDate = new Date(date);
            let newHighestStreak = userDoc.highestStreak;
            let newCurrentStreak = userDoc.currentStreak + 1;

            // Check if the new mood increases the highest streak
            if (mood > userDoc.mood[userDoc.mood.length - 1]?.mood) {
                newHighestStreak = Math.max(newHighestStreak, newCurrentStreak);
            }

            const result = await moodsCollection.updateOne(
                { userId },
                {
                    $push: {
                        mood: {
                            date: newDate,
                            mood: mood
                        }
                    },
                    $set: { currentStreak: newCurrentStreak, highestStreak: newHighestStreak }
                }
            );
            res.status(200).json({ message: 'Mood entry added!', result });
        } else {
            // If the user doesn't exist, create a new record
            const result = await moodsCollection.insertOne({
                userId,
                mood: [{ date: new Date(date), mood: mood }],
                currentStreak: 1,
                highestStreak: 1
            });
            res.status(201).json({ message: 'User and mood created!', result });
        }
    } catch (error) {
        console.error('Error while adding mood:', error);
        res.status(500).json({ error: 'Failed to add mood entry.' });
    }
});

app.get("/", (req, res) => {
	res.json({ tip: "Stay hydrated while coding!" });
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

app.get('/streak', requireAuth(), async (req, res) => {
	const { userId } = req.auth;                      
	try {
	const userDoc = await moodsCollection.findOne({ userId });
	if (!userDoc) {
	return res.status(404).json({ error: 'User not found' });
	}
	return res.json({ highestStreak: userDoc.highestStreak, currentStreak: userDoc.currentStreak});
} catch (err) {
	console.error('Fetch streak error:', err);
	res.status(500).json({ error: 'Could not fetch streak' });
}
});

// GET /weekly-moods
app.get('/weekly-moods', requireAuth(), async (req, res) => {
	const { userId } = req.auth;
	try {
		// Find the user document
		const userDoc = await moodsCollection.findOne({ userId });
		if (!userDoc) {
		return res.status(404).json({ error: 'User not found' });
		}

		// Extract and sort moods by date descending
		const sorted = userDoc.mood
		.map(entry => ({
			date: entry.date,                     // a Date object
			mood: entry.mood                       // a number
		}))
		.sort((a, b) => b.date - a.date)        // newest first
		.slice(0, 7);                           // take up to 7

		// Map dates back to ISO strings for frontend
		const lastSeven = sorted.map(e => ({
		date: e.date.toISOString().slice(0, 10),
		mood: e.mood
		}));

		res.json({ lastSeven });
	} catch (err) {
		console.error('Error fetching weekly moods:', err);
		res.status(500).json({ error: 'Server error' });
	}
});

app.get('/gemini-insight', requireAuth(), async (req, res) => {
    const { userId } = req.auth;
    try {
        const userDoc = await moodsCollection.findOne({ userId });
        if (!userDoc) {
            return res.status(404).json({ error: 'User not found' });
        }

        const mood_ratings = userDoc.mood
            .sort((a, b) => new Date(b.date) - new Date(a.date)) // newest first
            .slice(0, 7) // only the last 7 days
            .map(entry => entry.mood); // extract just mood scores

        const prompt = `In two or three small sentences, based on my daily mood ratings from 0 to 10 over the past few days ${JSON.stringify(mood_ratings)}, give me a short summary of how I've been doing emotionally and suggest simple ways I can continue improving my mental health.`;

        const apiKey = process.env.GEMINI_API_KEY;

        const response = await axios.post(`${GEMINI_API_URL}?key=${apiKey}`, {
            contents: [{
                parts: [{ text: prompt }]
            }]
        });

        const aiText = response.data.candidates[0].content.parts[0].text;
        res.json({ response: aiText });

    } catch (error) {
        console.error('Error fetching Gemini response:', error.response?.data || error.message);
        res.status(500).json({ error: 'Failed to get insight' });
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));