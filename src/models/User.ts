import { DataTypes, Model } from 'sequelize';
import type {
    CreationOptional,
    InferAttributes,
    InferCreationAttributes,
} from 'sequelize';
import sequelize from '../config/db.js';

class User extends Model<
    InferAttributes<User>,
    InferCreationAttributes<User>
> {
    declare userID: CreationOptional<number>;
    declare username: string;
    declare email: string;
    declare password: string;
    declare profileImage: string | null;
}

User.init(
    {
        userID: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            field: 'user_id',
        },
        username: {
            type: DataTypes.STRING(50),
            allowNull: false,
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
        },
        password: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        profileImage: {
            type: DataTypes.STRING(255),
            allowNull: true,
            field: 'profile_image',
        },
    },
    {
        sequelize,
        tableName: 'user',
        timestamps: false,
    },
);

export default User;
