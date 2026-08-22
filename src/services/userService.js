/**
 * User Service - Handles business logic for user operations
 */
const { UserModel, mockUserDatabase } = require('../models/userModel');

class UserService {
  async getAllUsers() {
    return mockUserDatabase;
  }

  async getUserById(id) {
    const user = mockUserDatabase.find((u) => u.id === id);
    if (!user) {
      throw new Error(`User with ID ${id} not found`);
    }
    return user;
  }

  async createUser(userData) {
    const newId = String(mockUserDatabase.length + 1);
    const newUser = new UserModel({ id: newId, ...userData });
    mockUserDatabase.push(newUser);
    return newUser;
  }

  async updateUser(id, updateData) {
    const index = mockUserDatabase.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new Error(`User with ID ${id} not found`);
    }
    mockUserDatabase[index] = { ...mockUserDatabase[index], ...updateData };
    return mockUserDatabase[index];
  }

  async deleteUser(id) {
    const index = mockUserDatabase.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new Error(`User with ID ${id} not found`);
    }
    const [deletedUser] = mockUserDatabase.splice(index, 1);
    return deletedUser;
  }
}

module.exports = new UserService();
