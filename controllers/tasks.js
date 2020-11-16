const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchLiveViewActions,
  fetchComposeViewActions,
  fetchUsers,
  fetchUsersWithInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
  fetchAppInstanceResources,
} = require('../services/analytics');
const { markTaskComplete } = require('../services/tasks');
const {
  writeLiveViewDataFile,
  writeComposeViewDataFile,
} = require('../utils/writeDataFile');
const uploadFile = require('../utils/uploadFile');
const deleteFileLocally = require('../utils/deleteFileLocally');
const hideFile = require('../utils/hideFile');
const {
  COMPOSE_VIEW_STRING,
  LIVE_VIEW_STRING,
  ITEMS_COLLECTION_NAME,
  LIVE_VIEW_ACTIONS_COLLECTION_NAME,
  COMPOSE_VIEW_ACTIONS_COLLECTION_NAME,
  USERS_COLLECTION_NAME,
  APP_INSTANCES_COLLECTION_NAME,
  APP_INSTANCE_RESOURCES_COLLECTION_NAME,
  TASKS_COLLECTION_NAME,
  LOCAL_CONTEXTUAL_STRING,
  LIGHT_USER_STRING,
  GRAASP_USER_STRING,
} = require('../config/constants');
const {
  BASE_URL,
  SPACES_PATH,
  FILE_UPLOAD_PATH,
  ITEMS_PATH,
} = require('../config/api');

const getTask = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const tasksCollection = db.collection(TASKS_COLLECTION_NAME);

  // extract userId and spaceId from request query
  const { userId, spaceId } = req.query;

  // extract requested view from request query
  let { view } = req.query;
  if (view !== COMPOSE_VIEW_STRING) {
    view = LIVE_VIEW_STRING;
  }

  try {
    const response = await tasksCollection.findOne({
      userId: ObjectId(userId),
      spaceId: ObjectId(spaceId),
      view,
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
    const tasksCollection = db.collection(TASKS_COLLECTION_NAME);

    // drop old MongoDB {userId, spaceId} index (from previous version of this middleware)
    // this is necessary to avoid conflicts with the updated index (below)
    // TODO: remove in next release (becomes redundant after index is dropped one time)
    tasksCollection.indexInformation({}, (error, result) => {
      if (result.userId_1_spaceId_1) {
        tasksCollection.dropIndex({ userId: 1, spaceId: 1 });
      }
    });

    // MongoDB index to enforce unique userId/spaceId/view combinations
    tasksCollection.createIndex(
      { userId: 1, spaceId: 1, view: 1 },
      { unique: true },
    );

    // MongoDB TTL index to remove task documents after createdAt stamp + expireAfterSeconds
    const ONE_DAY_IN_SECONDS = 86400;
    tasksCollection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: ONE_DAY_IN_SECONDS },
    );

    // extract userId and spaceId from request body (JSON); type-convert userId and spaceId
    const { userId: bodyUserId, spaceId: bodySpaceId } = req.body;
    if (!bodyUserId || !bodySpaceId) {
      return res.status(400).json({
        success: false,
        message: 'Missing userId or spaceId in request body.',
      });
    }
    const userId = ObjectId(bodyUserId);
    const spaceId = ObjectId(bodySpaceId);

    // extract requested view from request body; if view !== compose, default to live view
    let { view } = req.body;
    if (view !== COMPOSE_VIEW_STRING) {
      view = LIVE_VIEW_STRING;
    }

    // query DB to see if a request by this user for this space/view combo already exists
    const taskExists = await tasksCollection.findOne({ userId, spaceId, view });
    if (taskExists) {
      return res.status(403).json({
        success: false,
        message:
          'This request already exists. If you are seeing this message, it is likely that you have already requested data for this space/view combination in the past 24 hours. Please try again later.',
      });
    }

    // if 'taskExists()' fails to catch duplicates, uniqueness index will (goes to catch block)
    // otherwise, code in try block will run, creating the task
    try {
      const task = {
        userId,
        spaceId,
        view,
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

    const itemsCollection = db.collection(ITEMS_COLLECTION_NAME);
    const liveViewActionsCollection = db.collection(
      LIVE_VIEW_ACTIONS_COLLECTION_NAME,
    );
    const composeViewActionsCollection = db.collection(
      COMPOSE_VIEW_ACTIONS_COLLECTION_NAME,
    );
    const usersCollection = db.collection(USERS_COLLECTION_NAME);
    const appInstancesCollection = db.collection(APP_INSTANCES_COLLECTION_NAME);
    const tasksCollection = db.collection(TASKS_COLLECTION_NAME);
    const appInstanceResourcesCollection = db.collection(
      APP_INSTANCE_RESOURCES_COLLECTION_NAME,
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
    let actionsCursor;
    if (task.view === COMPOSE_VIEW_STRING) {
      actionsCursor = fetchComposeViewActions(
        composeViewActionsCollection,
        spaceIds,
      );
    } else {
      actionsCursor = fetchLiveViewActions(liveViewActionsCollection, spaceIds);
    }

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
    let users = usersWithInfo.map(({ provider, ...user }) => {
      return {
        ...user,
        type: provider.startsWith(LOCAL_CONTEXTUAL_STRING)
          ? LIGHT_USER_STRING
          : GRAASP_USER_STRING,
      };
    });

    if (task.view === COMPOSE_VIEW_STRING) {
      users = users.filter((user) => user.type === GRAASP_USER_STRING);
    }

    // create file name to write data to; create metadata object
    const fileName = `${task.createdAt.toISOString()}-${task._id.toString()}.json`;
    const metadata = {
      spaceTree,
      createdAt: new Date(Date.now()),
    };

    // if view not compose, fetch app instances, and append 'settings' key to each app inst. object
    // then write/upload/hide file w/appInstances and appInstanceResources
    // else (compose view) write file w/o appInstances and appInstanceResources
    if (task.view !== COMPOSE_VIEW_STRING) {
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

      writeLiveViewDataFile(
        fileName,
        actionsCursor,
        users,
        appInstances,
        appInstancesResourcesCursor,
        metadata,
        () => {
          uploadFile(
            `${BASE_URL}/${SPACES_PATH}/${task.spaceId}/${FILE_UPLOAD_PATH}`,
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
              hideFile(`${BASE_URL}/${ITEMS_PATH}`, req.headers.cookie, fileId);
            })
            .catch((err) => {
              logger.error(err);
            });
        },
      );
    } else {
      writeComposeViewDataFile(fileName, actionsCursor, users, metadata, () => {
        uploadFile(
          `${BASE_URL}/${SPACES_PATH}/${task.spaceId}/${FILE_UPLOAD_PATH}`,
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
            hideFile(`${BASE_URL}/${ITEMS_PATH}`, req.headers.cookie, fileId);
          })
          .catch((err) => {
            logger.error(err);
          });
      });
    }
  },
];

module.exports = { getTask, createTask };
