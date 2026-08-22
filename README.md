# ROZ FM Backend Service (`rozfm_backend`)

A modular Node.js & Express REST API architecture.

## Project Structure

```
rozfm_backend/
│
├── src/
│   ├── config/
│   │   └── database.js      # Database configuration & connection handler
│   │
│   ├── controllers/
│   │   └── userController.js# Express request/response logic for users
│   │
│   ├── models/
│   │   └── userModel.js     # Data layer & schema representation
│   │
│   ├── routes/
│   │   └── userRoutes.js    # Endpoint definitions for user management
│   │
│   ├── middleware/
│   │   └── authMiddleware.js# Token verification & authorization
│   │
│   ├── services/
│   │   └── userService.js   # Business logic layer
│   │
│   ├── utils/
│   │   └── response.js      # Standardized API response formatters
│   │
│   ├── app.js               # Express middleware configuration
│   └── server.js            # Server entry point & DB initialization
│
├── tests/                   # Test suits directory
├── .env                     # Local environment configurations
├── .gitignore               # Git ignored files
├── package.json             # NPM dependencies and scripts
└── README.md                # Project documentation
```

## Getting Started

### Prerequisites
- Node.js (v16+ recommended)
- npm

### Installation
1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables in `.env`:
   ```env
   PORT=5000
   NODE_ENV=development
   DB_URI=mongodb://localhost:27017/rozfm_db
   JWT_SECRET=your_jwt_secret_key
   ```

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Start production server:
   ```bash
   npm start
   ```

## API Routes Summary

| Method | Endpoint | Description | Protected |
| --- | --- | --- | --- |
| GET | `/api/health` | Health Check | No |
| GET | `/api/users` | List all users | Yes |
| GET | `/api/users/:id` | Get user by ID | Yes |
| POST | `/api/users` | Create new user | No |
| PUT | `/api/users/:id` | Update user | Yes |
| DELETE | `/api/users/:id` | Delete user | Yes |
