/**
 * User Controller - Handles HTTP requests & responses for users
 */
const userService = require('../services/userService');
const { sendSuccess, sendError } = require('../utils/response');

const getUsers = async (req, res) => {
  try {
    const users = await userService.getAllUsers();
    return sendSuccess(res, users, 'Users retrieved successfully');
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await userService.getUserById(req.params.id);
    return sendSuccess(res, user, 'User retrieved successfully');
  } catch (error) {
    return sendError(res, error.message, 404);
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, role } = req.body;
    if (!name || !email) {
      return sendError(res, 'Name and email are required fields', 400);
    }
    const newUser = await userService.createUser({ name, email, role });
    return sendSuccess(res, newUser, 'User created successfully', 201);
  } catch (error) {
    return sendError(res, error.message, 500);
  }
};

const updateUser = async (req, res) => {
  try {
    const updatedUser = await userService.updateUser(req.params.id, req.body);
    return sendSuccess(res, updatedUser, 'User updated successfully');
  } catch (error) {
    return sendError(res, error.message, 404);
  }
};

const deleteUser = async (req, res) => {
  try {
    const deletedUser = await userService.deleteUser(req.params.id);
    return sendSuccess(res, deletedUser, 'User deleted successfully');
  } catch (error) {
    return sendError(res, error.message, 404);
  }
};

module.exports = {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
};
