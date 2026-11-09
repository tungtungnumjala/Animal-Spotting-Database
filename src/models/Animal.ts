import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/db.js';

export interface AnimalAttributes {
  animalId?: number;
  categoryId: number;
  name: string;
  animalImagePin: string;
  spotsCount?: number;
}

// ! เพื่อกันการ require initialize
class Animal extends Model<AnimalAttributes> implements AnimalAttributes {
  public animalId!: number;
  public categoryId!: number;
  public name!: string;
  public animalImagePin!: string;
  public spotsCount!: number;
}

//field -> ชื่อ attr จริงภายในตาราง animal
Animal.init(
  {
    animalId: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      field: 'animal_id', 
    },
    categoryId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'category_id', 
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
    },
    animalImagePin: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'animal_image_pin', 
    },
    spotsCount: {
      type: DataTypes.INTEGER,
      defaultValue: 0,
      field: 'spots_count', 
    },
  },
  {
    sequelize,
    tableName: 'animal', // ชื่อตารางจริงใน DB 
    timestamps: true,
    underscored: true,
  }
);

export default Animal;