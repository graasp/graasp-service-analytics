const ObjectId = require('mongodb').ObjectId;
const { fetchWholeTree, fetchActions } = require('../services/analytics');

const getAnalytics = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const itemsCollection = db.collection('items');
  const actionsCollection = db.collection('appactions');

  // note: if actual count of actions in db < requestedSampleSize, MongoDB will return all actions
  const DEFAULT_SAMPLE_SIZE = 50000;
  const MAX_SAMPLE_SIZE = 100000;
  const MAX_TREE_LENGTH = 200;

  // extract query params, parse requestedSampleSize
  let { spaceId, requestedSampleSize } = req.query;
  if (!requestedSampleSize) {
    requestedSampleSize = DEFAULT_SAMPLE_SIZE;
  } else {
    requestedSampleSize = parseInt(requestedSampleSize, 10);
    if (requestedSampleSize > MAX_SAMPLE_SIZE)
      requestedSampleSize = MAX_SAMPLE_SIZE;
  }

  try {
    // fetch space tree
    const spaceTree = await fetchWholeTree(
      itemsCollection,
      [ObjectId(spaceId)],
      { MAX_TREE_LENGTH },
    );

    // fetch (sample of) actions of retrieved space ids
    const spaceIds = spaceTree.map((space) => space.id);
    const actions = await fetchActions(actionsCollection, spaceIds, {
      sampleSize: requestedSampleSize,
    });

    // structure results object to be returned
    const results = {
      spaceTree,
      actions,
      metadata: {
        numSpacesRetrieved: spaceTree.length,
        maxTreeLength: MAX_TREE_LENGTH,
        maxTreeLengthExceeded: spaceTree.length >= MAX_TREE_LENGTH,
        requestedSampleSize,
        numActionsRetrieved: actions.length,
      },
    };

    res.json(results);
  } catch (error) {
    next(error.message || error);
  }
};

const createTask = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const tasksCollection = db.collection('tasks');

  // extract request body (JSON); type-convert userId and spaceId
  const task = req.body;
  task.userId = ObjectId(task.userId);
  task.spaceId = ObjectId(task.spaceId);

  // MongoDB index to enforce unique userId/spaceId combinations
  tasksCollection.createIndex({ userId: 1, spaceId: 1 }, { unique: true });

  // MongoDB TTL index to remove task documents after createdAt stamp + expireAfterSeconds
  // ***TODO***: update expireAfterSeconds to 86,400 (one day)
  tasksCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 120 });

  // query DB to see if a request by this user for this space already exists
  const { userId, spaceId } = task;
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
      task.createdAt = new Date(Date.now());
      task.completed = false;
      task.location = null;
      const insertedTask = await tasksCollection.insert(task);

      res.status(202).json({
        success: true,
        message: 'Task created',
        task: insertedTask.ops[0],
      });

      // move request to middleware to create requested resource
      next();
    } catch (err) {
      await tasksCollection.deleteOne({ _id: task._id });
      res.status(403).json(err);
    }
  }
};

module.exports = { getAnalytics, createTask };
