import { DataTypes, Model } from 'sequelize';
import type {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import sequelize from '../../config/db.js';

class SpottedIn extends Model<
  InferAttributes<SpottedIn>,
  InferCreationAttributes<SpottedIn>
> {
  declare spotId: number;
  declare animalId: number;
}

SpottedIn.init(
  {
    spotId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
      field: 'spot_id',
    },
    animalId: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      allowNull: false,
      field: 'animal_id',
    },
  },
  {
    sequelize,
    tableName: 'spotted_in',
    timestamps: false,
    underscored: true,
  },
);

export default SpottedIn;