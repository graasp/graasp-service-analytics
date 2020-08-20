const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchActions,
  fetchUsers,
  fetchAppInstances,
  appendAppInstanceSettings,
} = require('../services/analytics');
const { markTaskComplete } = require('../services/tasks');
const writeDataFile = require('../utils/writeDataFile');
const uploadFile = require('../utils/uploadFile');
const deleteFileLocally = require('../utils/deleteFileLocally');
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
    return res.json(response);
  } catch (err) {
    return res.status(500).json(err);
  }
};

const createTask = [
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
    }

    // if 'taskExists()' fails to catch duplicates, uniqueness index will (goes to catch block)
    // otherwise, code in try block will run, creating the task
    try {
      const task = {
        userId,
        spaceId,
        createdAt: new Date(Date.now()),
        completed: false,
        location: null,
      };
      const insertedTask = await tasksCollection.insertOne(task);

      res.status(202).json({
        success: true,
        message: 'Task created',
        task: insertedTask.ops[0],
      });

      // move request to middleware to create requested resource
      res.locals.task = insertedTask;
      return next();
    } catch (err) {
      return res.status(403).json(err);
    }
  },
  // execute task and post result
  async (req, res) => {
    const { db, logger } = req.app.locals;

    const itemsCollection = db.collection('items');
    const actionsCollection = db.collection('appactions');
    const usersCollection = db.collection('users');
    const appInstancesCollection = db.collection('appinstances');
    const tasksCollection = db.collection('tasks');

    // newly created task object returned by previous middleware
    let { task } = res.locals;
    [task] = task.ops;

    // fetch *whole* space tree
    const spaceTree = await fetchWholeTree(itemsCollection, [
      ObjectId(task.spaceId),
    ]);

    // fetch actions cursor of retrieved tree
    const spaceIds = spaceTree.map((space) => space.id);
    const actionsCursor = fetchActions(actionsCollection, spaceIds);

    // fetch users registered to the array of space ids
    // the two .map statements transform user objects to align with other Graasp APIs
    // (1) first map renames "provider" key to "type"
    // (2) second map: if "type" value begins with "local-contextual", classify user as 'light'
    const usersCursor = fetchUsers(usersCollection, spaceIds);
    const usersArray = await usersCursor.toArray();
    const users = usersArray
      .map(({ provider: type, ...otherKeys }) => ({
        type,
        ...otherKeys,
      }))
      // eslint-disable-next-line arrow-body-style
      .map((user) => {
        return user.type.indexOf('local-contextual') === 0
          ? { ...user, type: 'light' }
          : { ...user, type: 'graasp' };
      });

    // fetch app instances, and then append 'settings' key to each app instance object
    const appInstancesCursor = await fetchAppInstances(
      itemsCollection,
      task.spaceId,
    );
    const appInstancesArray = await appInstancesCursor.toArray();
    const appInstances = [];
    for (let i = 0; i < appInstancesArray.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const appInstanceWithSettings = await appendAppInstanceSettings(
        appInstancesCollection,
        appInstancesArray[i],
      );
      appInstances.push(appInstanceWithSettings);
    }

    // create file name to write data to; create metadata object; write/upload/hide file
    const fileName = `${task.createdAt.toISOString()}-${task._id.toString()}.json`;
    const metadata = {
      spaceTree,
      users,
      appInstances,
      createdAt: new Date(Date.now()),
    };
    writeDataFile(fileName, actionsCursor, metadata, () => {
      uploadFile(
        `https://graasp.eu/spaces/${task.spaceId}/file-upload`,
        req.headers.cookie,
        fileName,
      )
        .catch(async (err) => {
          logger.error(err);
          logger.debug('operation failed during file upload');
          await tasksCollection.deleteOne({ _id: task._id });
          logger.debug('attempting to delete created resource');
          deleteFileLocally(fileName);
          throw err;
        })
        .then((fileId) => {
          markTaskComplete(tasksCollection, task._id, fileId);
          hideFile('https://graasp.eu/items/', req.headers.cookie, fileId);
        })
        .catch((err) => {
          logger.error(err);
        });
    });
  },
];

module.exports = { getTask, createTask };
