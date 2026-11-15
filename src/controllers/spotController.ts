import type { Request, Response } from 'express';
import { QueryTypes } from 'sequelize';
import sequelize from '../config/db.js';
import Spot from '../models/Spot.js';

// GET /api/spots
export const getAllSpots = async (req: Request, res: Response) => {
  try {
    const spots = await sequelize.query(
      `
      SELECT 
        s.spot_id AS id,
        s.title,
        s.description,
        s.address,
        s.latitude AS lat,
        s.longitude AS lng,
        s.created_at AS createdAt,
        u.username AS authorName,
        u.profile_image AS authorAvatar,
        GROUP_CONCAT(DISTINCT a.name) AS animalNames,
        GROUP_CONCAT(DISTINCT a.animal_image_pin) AS animalPins,
        GROUP_CONCAT(DISTINCT p.photo_url) AS photoUrls
      FROM spot s
      LEFT JOIN user u ON s.user_id = u.user_id
      LEFT JOIN spotted_in si ON s.spot_id = si.spot_id
      LEFT JOIN animal a ON si.animal_id = a.animal_id
      LEFT JOIN photo p ON s.spot_id = p.spot_id
      GROUP BY s.spot_id
      ORDER BY s.created_at DESC
      `,
      { type: QueryTypes.SELECT }
    );

    const formatted = spots.map((row: any) => {
      const photos = row.photoUrls ? row.photoUrls.split(',') : [];
      const pins = row.animalPins ? row.animalPins.split(',') : [];

      return {
        id: row.id,
        title: row.title,
        description: row.description || '',
        address: row.address || '',
        lat: Number(row.lat),
        lng: Number(row.lng),
        authorName: row.authorName || 'Spotter',
        authorAvatar: row.authorAvatar || '',
        category: row.animalNames ? row.animalNames.split(',') : ['general'],
        pinName: pins[0] || undefined,
        images: photos,
        photoUrl: photos[0] || '',
        createdAt: row.createdAt,
      };
    });

    res.json({ success: true, data: formatted });
  } catch (error) {
    console.error('Error fetching spots:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch spots' });
  }
};

// POST /api/spots
export const createSpot = async (req: Request, res: Response) => {
  const t = await sequelize.transaction();
  try {
    const {
      title,
      description = '',
      address,
      lat,
      lng,
      userId = 1,
      category = [],
      images = [],
      photoUrl = '',
    } = req.body;

    // 1. บันทึกลงตาราง spot
    const newSpot = await Spot.create(
      {
        userId,
        title,
        description,
        address,
        latitude: lat,
        longitude: lng,
      },
      { transaction: t }
    );

    const spotId = newSpot.spotId;

    // 2. บันทึกรูปภาพลงตาราง photo (ถ้ามี)
    const allPhotos = images.length > 0 ? images : photoUrl ? [photoUrl] : [];
    for (const url of allPhotos) {
      if (url) {
        await sequelize.query(
          `INSERT INTO photo (spot_id, photo_url) VALUES (:spotId, :url)`,
          {
            replacements: { spotId, url },
            type: QueryTypes.INSERT,
            transaction: t,
          }
        );
      }
    }

    // 3. เชื่อมชนิดสัตว์ลงตาราง spotted_in (ค้นหา animal_id จากชื่อสัตว์)
    if (Array.isArray(category) && category.length > 0) {
      for (const animalName of category) {
        const found: any[] = await sequelize.query(
          `SELECT animal_id FROM animal WHERE LOWER(name) = LOWER(:name) LIMIT 1`,
          {
            replacements: { name: animalName },
            type: QueryTypes.SELECT,
            transaction: t,
          }
        );

        if (found.length > 0) {
          await sequelize.query(
            `INSERT IGNORE INTO spotted_in (spot_id, animal_id) VALUES (:spotId, :animalId)`,
            {
              replacements: { spotId, animalId: found[0].animal_id },
              type: QueryTypes.INSERT,
              transaction: t,
            }
          );
        }
      }
    }

    await t.commit();

    res.status(201).json({
      success: true,
      data: {
        id: spotId,
        title: newSpot.title,
        description: newSpot.description,
        address: newSpot.address,
        lat: Number(newSpot.latitude),
        lng: Number(newSpot.longitude),
        category,
        images: allPhotos,
        photoUrl: allPhotos[0] || '',
      },
    });
  } catch (error) {
    await t.rollback();
    console.error('Error creating spot:', error);
    res.status(500).json({ success: false, message: 'Failed to create spot' });
  }
};