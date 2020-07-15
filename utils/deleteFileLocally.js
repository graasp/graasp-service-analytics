const fs = require('fs');

const deleteFileLocally = (filePath) => {
  fs.unlink(filePath, (err) => {
    if (err) {
      throw err;
    }
  });
};

module.exports = deleteFileLocally;
