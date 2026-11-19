import express from 'express';
import cors from 'cors';
import session from 'express-session';
import sequelize from './config/db.js';
import animalRoutes from './routes/animalRoutes.js';
import spotRoutes from './routes/spotRoutes.js'
import authRoutes from './routes/authRoutes.js';
import collectionRoutes from "./routes/collectionRoutes.js";

const app = express();
const PORT = process.env.PORT || 5000;

// session cookie
const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
    throw new Error('SESSION_SECRET is required');
}

app.use(
    cors({
        origin: 'http://localhost:3000',
        credentials: true,
    }),
);

app.use(express.json());

app.use(
    session({
        name: 'animal-spotting.sid',
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            maxAge: 1000 * 60 * 60 * 24,
        },
    }),
);

app.use('/api/animals', animalRoutes);
app.use('/api/spots', spotRoutes);
app.use('/api/auth', authRoutes);
app.use("/api/collection", collectionRoutes);

app.get('/', (req, res) => {
    res.send('Animal Spotting API is running! 🦁🐯');
});

const startServer = async () => {
    try {
        await sequelize.authenticate();
        console.log('Succesfully connected to server');

        app.listen(PORT, () => {
            console.log(`Server running at PORT: ${PORT}`);
        });
    } catch (error) {
        console.error('Error cannot connected to server', error);
    }
};

startServer();
