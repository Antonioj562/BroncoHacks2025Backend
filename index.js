import express from 'express';
import { MongoClient, ServerApiVersion } from 'mongodb';
import { clerkClient, requireAuth, clerkMiddleware, getAuth } from '@clerk/express';
import dotenv from 'dotenv/config';
import cors from 'cors';

const app = express();
const corsOptions = {
    origin: 'http://localhost:5173', // Frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE'], // Allowed HTTP methods
    allowedHeaders: ['Content-Type', 'Authorization'], // Allowed headers
    credentials: true,  // If you need to send cookies or authentication headers
};

app.use(cors(corsOptions));  // Enable CORS with options
app.use(clerkMiddleware({
	publishableKey: process.env.CLERK_API_KEY,
	secretKey: process.env.CLERK_SECRET_KEY
}));
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
	const { userId } = req.auth;                       // Clerk gives you the userId
	try {
	const userDoc = await moodsCollection.findOne({ userId });
	if (!userDoc) {
	return res.status(404).json({ error: 'User not found' });
	}
	return res.json({ highestStreak: userDoc.highestStreak });
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

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
