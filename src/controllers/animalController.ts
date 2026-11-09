import type { Request, Response } from 'express';
import Animal from '../models/Animal.js';

export const getAllAnimals = async (req: Request, res: Response): Promise<void> => {
  try {
    const animals = await Animal.findAll();
    res.status(200).json({
      success: true,
      message: 'Successfully fetched animals',  
      data: animals,
    });
  } catch (error) {
    console.error('Error fetching animals:', error);
    res.status(500).json({
      success: false,
      message: 'Internal Server Error',
    });
  }
};