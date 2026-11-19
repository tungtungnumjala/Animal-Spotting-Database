import Spot from './Relation/Spot.js';
import Photo from './Relation/Photo.js';
import Animal from './Relation/Animal.js';
import Category from './Relation/Category.js';
import SpottedIn from './Relation/SpottedIn.js';
import User from './Relation/User.js';

// Spot 1:N Photo
Spot.hasMany(Photo, { foreignKey: 'spotId', as: 'photos' });
Photo.belongsTo(Spot, { foreignKey: 'spotId', as: 'spot' });

// Spot M:N Animal (ผ่าน spotted_in)
Spot.belongsToMany(Animal, {
  through: SpottedIn,
  foreignKey: 'spotId',
  otherKey: 'animalId',
  as: 'animals',
});
Animal.belongsToMany(Spot, {
  through: SpottedIn,
  foreignKey: 'animalId',
  otherKey: 'spotId',
  as: 'spots',
});

// Category 1:N Animal
Category.hasMany(Animal, { foreignKey: 'categoryId', as: 'animals'});
Animal.belongsTo(Category, { foreignKey: 'categoryId', as: 'category' });

// User 1:N Spot
User.hasMany(Spot, { foreignKey: 'userId', as: 'spots' });
Spot.belongsTo(User, { foreignKey: 'userId', as: 'user' });

export { User, Spot, Photo, Animal, SpottedIn, Category };