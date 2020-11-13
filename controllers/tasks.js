const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchLiveViewActions,
  fetchUsers,
  fetchUsersWithInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
  fetchAppInstanceResources,
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
  // this portion of the middleware executes the task and posts the result to graasp
  async (req, res) => {
    const { db, logger } = req.app.locals;

    const itemsCollection = db.collection('items');
    const actionsCollection = db.collection('appactions');
    const usersCollection = db.collection('users');
    const appInstancesCollection = db.collection('appinstances');
    const tasksCollection = db.collection('tasks');
    const appInstanceResourcesCollection = db.collection(
      'appinstanceresources',
    );

    // newly created task object returned by previous middleware
    let { task } = res.locals;
    [task] = task.ops;

    // fetch *whole* space tree
    const spaceTree = await fetchWholeTree(itemsCollection, [
      ObjectId(task.spaceId),
    ]);

    // fetch actions cursor of retrieved tree
    const spaceIds = spaceTree.map((space) => space.id);
    const actionsCursor = fetchLiveViewActions(actionsCollection, spaceIds);

    // fetch users by space ids; convert mongo cursor to array
    const usersCursor = fetchUsers(itemsCollection, spaceIds);
    const usersArray = await usersCursor.toArray();

    // 'usersArray' is an array of objects, each with a 'memberships' key
    // each 'memberships' key holds an array of objects, each of the format { userId: <mongoId> }
    // i.e. usersArray = [ { memberships: [ { userId: <mongoId> }, ... ] }, ... ]
    let userIds = [];
    usersArray.forEach(({ memberships }) => {
      if (memberships) {
        memberships.forEach(({ userId }) => {
          userIds.push(userId.toString());
        });
      }
    });
    // filter out duplicate userIds
    userIds = [...new Set(userIds)];

    // for each user, add 'additional info' by querying the 'users' collection
    const usersWithInfo = await fetchUsersWithInfo(
      usersCollection,
      userIds,
    ).toArray();

    // rename user "provider" key to "type" and change its value to be either 'light' or 'graasp'
    // eslint-disable-next-line arrow-body-style
    const users = usersWithInfo.map(({ provider, ...user }) => {
      return {
        ...user,
        type: provider.startsWith('local-contextual') ? 'light' : 'graasp',
      };
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

    const appInstanceIds = appInstances.map((appInstance) => appInstance._id);
    const appInstancesResourcesCursor = fetchAppInstanceResources(
      appInstanceResourcesCollection,
      appInstanceIds,
    );

    // create file name to write data to; create metadata object; write/upload/hide file
    const fileName = `${task.createdAt.toISOString()}-${task._id.toString()}.json`;
    const metadata = {
      spaceTree,
      createdAt: new Date(Date.now()),
    };

    writeDataFile(
      fileName,
      actionsCursor,
      users,
      appInstances,
      appInstancesResourcesCursor,
      metadata,
      () => {
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
      },
    );
  },
];

module.exports = { getTask, createTask };
