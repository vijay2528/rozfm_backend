/**
 * Database Configuration & Connection Setup
 */

const connectDB = async () => {
  try {
    const dbUri = process.env.DB_URI || 'mongodb://localhost:27017/rozfm_db';
    console.log(`[Database] Connecting to: ${dbUri}`);
    
    // Stub for DB connection (e.g. Mongoose, Sequelize, Prisma, or PG)
    // Example for Mongoose:
    // await mongoose.connect(dbUri);
    
    console.log('[Database] Database connection established successfully.');
  } catch (error) {
    console.error(`[Database Error] Failed to connect: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
