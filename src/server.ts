import express from 'express';
import cors from 'cors';
import sequelize from './config/db.js';
import animalRoutes from './routes/animalRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.use('/api/animals', animalRoutes);

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
