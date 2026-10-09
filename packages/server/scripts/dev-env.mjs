// Keep the existing development defaults while allowing isolated test data.
process.env.DATA_DIR ??= "../../data";
process.env.BOOTSTRAP_API_KEY ??= "dev-api-key-change-me";
process.env.JWT_SECRET ??= "dev-jwt-secret-change-me";
