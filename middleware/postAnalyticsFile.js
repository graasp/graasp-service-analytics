const fs = require('fs');
const ObjectId = require('mongodb').ObjectId;
const { fetchWholeTree, fetchActions } = require('../services/analytics');
const markTaskComplete = require('../services/tasks');
const uploadFile = require('../utils/uploadFile');
const hideFile = require('../utils/hideFile');

const postAnalyticsFile = async (req) => {
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const itemsCollection = db.collection('items');
  const actionsCollection = db.collection('appactions');
  const tasksCollection = db.collection('tasks');

  // newly created task object returned by /analytics POST endpoint
  const task = req.body;

  // fetch *whole* space tree
  const spaceTree = await fetchWholeTree(itemsCollection, [
    ObjectId(task.spaceId),
  ]);

  // fetch actions of retrieved tree
  const spaceIds = spaceTree.map((space) => space.id);
  const actions = await fetchActions(actionsCollection, spaceIds);

  // create data object to be written to file
  const fileData = {
    data: { actions },
    metaData: {
      spaceTree,
      createdAt: new Date(Date.now()),
      numSpacesRetrieved: spaceTree.length,
      numActionsRetrieved: actions.length,
    },
  };

  // write fileData to file
  const jsonData = JSON.stringify(fileData, null, 2);
  const fileName = `${task.createdAt.toISOString()}-${task._id.toString()}.json`;
  fs.writeFile(fileName, jsonData, async () => {
    const { _id: fileId } = await uploadFile(
      // for testing, use spaceId 5ed5f92233c8a33f3d5d87a5
      // ***TODO***: Update URL to take generic spaceId
      `https://graasp.eu/spaces/5ed5f92233c8a33f3d5d87a5/file-upload`,
      req.headers.cookie,
      fileName,
    );
    await hideFile('https://graasp.eu/items/', req.headers.cookie, fileId);
    await markTaskComplete(tasksCollection, task._id, fileId);
  });
};

module.exports = postAnalyticsFile;
