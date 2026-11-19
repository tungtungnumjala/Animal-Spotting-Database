import { DataTypes, Model } from 'sequelize';
import type {
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from 'sequelize';
import sequelize from '../../config/db.js';

class Category extends Model<
  InferAttributes<Category>,
  InferCreationAttributes<Category>
> {
  declare categoryId: CreationOptional<number>;
  declare name: string;
}

Category.init(
  {
    categoryId: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
      field: 'category_id',
    },
    name: {
      type: DataTypes.STRING(50),
      allowNull: false,
      field: 'category_name', // ตรงกับ SQL: category_name
    },
  },
  {
    sequelize,
    tableName: 'category',
    timestamps: false,
    underscored: true,
  },
);

export default Category;