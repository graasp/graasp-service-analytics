const fs = require('fs');

const writeDataFile = (fileName, mongoCursor, metadata, callback) => {
  const file = fs.createWriteStream(fileName, { flags: 'a' });
  file.write('{\n"data": {"actions":[\n');
  let separator = '';
  mongoCursor.forEach(
    (document) => {
      file.write(separator + JSON.stringify(document, null, 2));
      if (!separator) {
        separator = ',\n';
      }
    },
    () => {
      file.write(`]\n}, "metadata": ${JSON.stringify(metadata)} \n}`);
      callback();
    },
  );
};

module.exports = writeDataFile;
