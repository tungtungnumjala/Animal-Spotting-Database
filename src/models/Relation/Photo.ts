import { DataTypes, Model } from 'sequelize';
import type {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import sequelize from '../../config/db.js';

class Photo extends Model<
  InferAttributes<Photo>,
  InferCreationAttributes<Photo>
> {
  declare photoId: CreationOptional<number>;
  declare spotId: number;
  declare photoUrl: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Photo.init(
  {
    photoId: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      field: 'photo_id',
    },
    spotId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      field: 'spot_id',
    },
    photoUrl: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'photo_url',
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
    tableName: 'photo',
    timestamps: true,
    underscored: true,
  },
);

export default Photo;