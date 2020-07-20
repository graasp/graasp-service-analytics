const fs = require('fs');
const ObjectId = require('mongodb').ObjectId;
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
    const ONE_DAY_IN_SECONDS = 86400;
    tasksCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: ONE_DAY_IN_SECONDS },
    );

    // extract request body (JSON); type-convert userId and spaceId
    const { userId: bodyUserId, spaceId: bodySpaceId } = req.body;
    if (!bodyUserId || !bodySpaceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId or spaceId in request body.',
      });
    }
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
        res.status(403).json(err);
      }
    }
  },
  // execute task and post result
  async (req, res, next) => {
    const { db, logger } = req.app.locals;

    const itemsCollection = db.collection('items');
    const actionsCollection = db.collection('appactions');
    const tasksCollection = db.collection('tasks');

    // newly created task object returned by previous middleware
    let { task } = res.locals;
    task = task.ops[0];

    // fetch *whole* space tree
    logger.debug('fetching whole space tree');
    const spaceTree = await fetchWholeTree(itemsCollection, [
      ObjectId(task.spaceId),
    ]);

    // fetch actions cursor of retrieved tree
    const spaceIds = spaceTree.map((space) => space.id);
    logger.debug('fetching actions cursor');
    const actionsCursor = await fetchActions(actionsCollection, spaceIds);

    // create file name to write data to
    logger.debug('beginning file write');
    const fileName = `${task.createdAt.toISOString()}-${task._id.toString()}.json`;

    // write opening array bracket onto JSON file
    await fs.writeFile(fileName, '[\n', (err) => {
      if (err) {
        logger.error(err);
      }
    });

    // iterate over cursor and write each document onto JSON file
    let separator = '';
    await actionsCursor.forEach((document) => {
      fs.appendFile(
        fileName,
        separator + JSON.stringify(document, null, 2),
        (err) => {
          if (err) {
            logger.error(err);
          }
        },
      );
      if (!separator) {
        separator = ',\n';
      }
    });

    // write closing bracket onto JSON file
    await fs.appendFile(fileName, '\n]\n', async (err) => {
      if (err) {
        logger.error(err);
      }
    });

    // trigger upload/delete/hide/task complete operations
    try {
      logger.debug('file write complete; uploading file');
      const fileId = await uploadFile(
        // for testing, use spaceId 5ed5f92233c8a33f3d5d87a5
        `https://graasp.eu/spaces/5ed5f92233c8a33f3d5d87a5/file-upload`,
        req.headers.cookie,
        fileName,
      );
      logger.debug('hiding file');
      await hideFile('https://graasp.eu/items/', req.headers.cookie, fileId);
      logger.debug('marking task complete');
      await markTaskComplete(tasksCollection, task._id, fileId);
    } catch (err) {
      logger.error(err);
      await tasksCollection.deleteOne({ _id: task._id });
    }
  },
];

module.exports = { getTask, createTask };
