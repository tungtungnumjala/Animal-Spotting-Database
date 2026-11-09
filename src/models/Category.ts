import { DataTypes, Model } from 'sequelize';
import sequelize from '../config/db.js';

export interface CategoryAttributes {
  categoryId?: number;
  name: string;
}

class Category extends Model<CategoryAttributes> implements CategoryAttributes {
  public categoryId!: number;
  public name!: string;
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
      type: DataTypes.STRING,
      allowNull: false,
    },
  },
  {
    sequelize,
    tableName: 'category', 
    timestamps: false,
    underscored: true,
  }
);

export default Category;