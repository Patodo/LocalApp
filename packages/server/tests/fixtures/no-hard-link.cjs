const fs = require("node:fs");

fs.linkSync = () => {
  const error = new Error("hard links unsupported for test");
  error.code = "EOPNOTSUPP";
  throw error;
};
