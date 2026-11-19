import { DataTypes, Model } from 'sequelize';
import type {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import sequelize from '../../config/db.js';

class Animal extends Model<
  InferAttributes<Animal>,
  InferCreationAttributes<Animal>
> {
  declare animalId: CreationOptional<number>;
  declare categoryId: number;
  declare name: string;
  declare animalImagePin: string;
  declare spotsCount: CreationOptional<number>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

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
      type: DataTypes.STRING(50),
      allowNull: false,
    },
    animalImagePin: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'animal_image_pin',
    },
    spotsCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
      field: 'spots_count',
    },
    createdAt: {
      type: DataTypes.DATE,
      field: 'created_at',
    },
    updatedAt: {
      type: DataTypes.DATE,
      field: 'updated_at',
    },
  },
  {
    sequelize,
    tableName: 'animal',
    timestamps: true,
    underscored: true,
  },
);

export default Animal;