const fs = require('fs');

// iterates over a mongocursor and writes a json file with "data" and "metadata" key-value pairs
const writeDataFile = (fileName, mongoCursor, metadata, callback) => {
  // init writable stream
  const file = fs.createWriteStream(fileName, { flags: 'a' });

  // create opening lines of json file
  file.write('{\n"data": {"actions":[\n');

  // var separator is used in forEach loop below to delimit mongodb docs when writing to file
  let separator = '';
  mongoCursor.forEach(
    (document) => {
      file.write(separator + JSON.stringify(document, null, 2));
      if (!separator) {
        separator = ',\n';
      }
    },
    // this callback comes with mongo cursor .forEach method
    () => {
      // close "data" key-value pair, add metadata key-value pair, close entire json object
      file.write(`]\n}, "metadata": ${JSON.stringify(metadata)} \n}`);

      // custom callback triggered after file write is complete
      callback();
    },
  );
};

module.exports = writeDataFile;
