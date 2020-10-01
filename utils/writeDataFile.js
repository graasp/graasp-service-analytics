const fs = require('fs');

// writeDataFile takes the cursors and arrays retrieved from the DB and writes them to a json file
// cursors (actions and appInstanceResources) are written to file using Mongo's .forEach method
// other data (users, appInstances) is received as an array and written to file with file.write
const writeDataFile = (
  fileName,
  actionsCursor,
  usersArray,
  appInstancesArray,
  appInstancesResourcesCursor,
  metadata,
  callback,
) => {
  // init writable stream
  const file = fs.createWriteStream(fileName, { flags: 'a' });

  // set up error handler
  file.on('error', (err) => {
    throw err;
  });

  // create opening lines of json file
  file.write('{"data": {"actions":[');

  // separator is used in forEach loops below to delimit mongo cursor docs when writing to file
  let separator = '';

  actionsCursor.forEach(
    (document) => {
      file.write(separator + JSON.stringify(document));
      if (!separator) {
        separator = ',';
      }
    },
    // this callback comes with mongo cursor .forEach method, and executes after .forEach completes
    () => {
      // reset separator to be used in second mongo cursor
      separator = '';
      // use file.write to write users and appInstances arrays to file,
      file.write(
        `],"users":${JSON.stringify(
          usersArray,
        )},"appInstances":${JSON.stringify(
          appInstancesArray,
        )}, "appInstanceResources":[`,
        null,
        // file.write's callback - executes when file.write completes
        appInstancesResourcesCursor.forEach(
          (document) => {
            file.write(separator + JSON.stringify(document));
            if (!separator) {
              separator = ',';
            }
          },
          // callback of 2nd mongo cursor .forEach: add metadata, close json file
          () => {
            file.write(
              `], "metadata": ${JSON.stringify(metadata)}}}`,
              null,
              // custom callback in tasks.js (performs other file operations once write is complete)
              callback,
            );
          },
        ),
      );
    },
  );
};

module.exports = writeDataFile;
