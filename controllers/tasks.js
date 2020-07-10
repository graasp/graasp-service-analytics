const ObjectId = require('mongodb').ObjectId;
const fs = require('fs');
const { fetchWholeTree, fetchActions } = require('../services/analytics');
const { markTaskComplete } = require('../services/tasks');
const uploadFile = require('../utils/uploadFile');
const hideFile = require('../utils/hideFile');

const getTask = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const tasksCollection = db.collection('tasks');

  // extract userId and spaceId from request query
  const { userId, spaceId } = req.query;

  try {
    const response = await tasksCollection.findOne({
      userId: ObjectId(userId),
      spaceId: ObjectId(spaceId),
    });
    if (!response) {
      return res.status(404).json({ error: 'Task not found.' });
    }
    res.json(response);
  } catch (err) {
    res.status(500).json(err);
  }
};

const createTask = [
  // create task
  async (req, res, next) => {
    // extract and set DB/collection parameters
    const { db } = req.app.locals;
    if (!db) {
      return next('Missing db handler');
    }
    const tasksCollection = db.collection('tasks');

    // MongoDB index to enforce unique userId/spaceId combinations
    tasksCollection.createIndex({ userId: 1, spaceId: 1 }, { unique: true });

    // MongoDB TTL index to remove task documents after createdAt stamp + expireAfterSeconds
    // ***TODO***: update expireAfterSeconds to 86,400 (one day)
    tasksCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 120 });

    // extract request body (JSON); type-convert userId and spaceId
    const { userId: bodyUserId, spaceId: bodySpaceId } = req.body;
    const userId = ObjectId(bodyUserId);
    const spaceId = ObjectId(bodySpaceId);

    // query DB to see if a request by this user for this space already exists
    const taskExists = await tasksCollection.findOne({ userId, spaceId });

    if (taskExists) {
      return res.status(403).json({
        success: false,
        message:
          'This request already exists. If you are seeing this message, it is likely that you have already requested data for this space in the past 24 hours. Please try again later.',
      });
    } else {
      // if 'taskExists' fails to catch duplicate entries, uniqueness index will do so (jumps to catch block)
      // otherwise, code in try block will run, creating the task
      try {
        const task = {
          userId,
          spaceId,
          createdAt: new Date(Date.now()),
          completed: false,
          location: null,
        };
        const insertedTask = await tasksCollection.insert(task);

        res.status(202).json({
          success: true,
          message: 'Task created',
          task: insertedTask.ops[0],
        });

        // move request to middleware to create requested resource
        res.locals.task = insertedTask;
        next();
      } catch (err) {
        // TODO: does this make sense? if the insert fails there's no task to delete.
        // Also I think '_id' is undefined.
        await tasksCollection.deleteOne({ _id: task._id });
        res.status(403).json(err);
      }
    }
  },
  // execute task and post result
  async (req, res, next) => {
    const { db } = req.app.locals;

    const itemsCollection = db.collection('items');
    const actionsCollection = db.collection('appactions');
    const tasksCollection = db.collection('tasks');

    // newly created task object returned by previous middleware
    const { task } = res.locals;

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
  }
];

module.exports = { getTask, createTask };
