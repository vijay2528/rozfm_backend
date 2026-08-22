/**
 * User Data Model / Schema definition
 */

class UserModel {
  constructor({ id, name, email, role = 'user', createdAt = new Date() }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.role = role;
    this.createdAt = createdAt;
  }
}

// In-memory data store placeholder for initial setup
const mockUserDatabase = [
  new UserModel({ id: '1', name: 'John Doe', email: 'john@rozfm.com', role: 'admin' }),
  new UserModel({ id: '2', name: 'Jane Smith', email: 'jane@rozfm.com', role: 'user' }),
];

module.exports = {
  UserModel,
  mockUserDatabase,
};
