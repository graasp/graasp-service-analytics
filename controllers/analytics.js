const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchLiveViewActions,
  fetchComposeViewActions,
  fetchUsers,
  fetchUsersWithInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
} = require('../services/analytics');
const {
  COMPOSE_VIEW_STRING,
  ITEMS_COLLECTION_NAME,
  LIVE_VIEW_ACTIONS_COLLECTION_NAME,
  COMPOSE_VIEW_ACTIONS_COLLECTION_NAME,
  USERS_COLLECTION_NAME,
  APP_INSTANCES_COLLECTION_NAME,
  LOCAL_CONTEXTUAL_STRING,
  LIGHT_USER_STRING,
  GRAASP_USER_STRING,
} = require('../config/constants');

const getAnalytics = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db, logger } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }

  // note: appActionsCollection has 'live view' actions, actionsCollection 'compose view' actions
  const itemsCollection = db.collection(ITEMS_COLLECTION_NAME);
  const liveViewActionsCollection = db.collection(
    LIVE_VIEW_ACTIONS_COLLECTION_NAME,
  );
  const composeViewActionsCollection = db.collection(
    COMPOSE_VIEW_ACTIONS_COLLECTION_NAME,
  );
  const usersCollection = db.collection(USERS_COLLECTION_NAME);
  const appInstancesCollection = db.collection(APP_INSTANCES_COLLECTION_NAME);

  // note: if actual count of actions in db < requestedSampleSize, MongoDB will return all actions
  const DEFAULT_SAMPLE_SIZE = 50000;
  const MAX_SAMPLE_SIZE = 100000;
  const MAX_TREE_LENGTH = 200;

  // extract query params, parse requestedSampleSize
  logger.debug('extracting spaceId and requestedSampleSize from req.query');
  const { spaceId, view } = req.query;
  let { requestedSampleSize } = req.query;
  if (!requestedSampleSize) {
    requestedSampleSize = DEFAULT_SAMPLE_SIZE;
  } else {
    requestedSampleSize = parseInt(requestedSampleSize, 10);
    if (requestedSampleSize > MAX_SAMPLE_SIZE) {
      requestedSampleSize = MAX_SAMPLE_SIZE;
    }
  }

  try {
    // fetch space tree
    logger.debug('fetching space tree');
    const spaceTree = await fetchWholeTree(
      itemsCollection,
      [ObjectId(spaceId)],
      { MAX_TREE_LENGTH },
    );

    // map array of spaceId objects to array of space ids
    logger.debug('mapping array of spaceId objects to array of spaceIds');
    const spaceIds = spaceTree.map((space) => space.id);

    // fetch (sample of) actions of retrieved space ids, depending on view requested
    logger.debug('fetching sample of actions of retrieved spaceIds');
    let actionsCursor;
    if (view === COMPOSE_VIEW_STRING) {
      actionsCursor = fetchComposeViewActions(
        composeViewActionsCollection,
        spaceIds,
        {
          sampleSize: requestedSampleSize,
        },
      );
    } else {
      actionsCursor = fetchLiveViewActions(
        liveViewActionsCollection,
        spaceIds,
        {
          sampleSize: requestedSampleSize,
        },
      );
    }
    const actions = await actionsCursor.toArray();

    // fetch users by space ids; convert mongo cursor to array
    logger.debug('fetching users of retrieved spaceIds');
    const usersCursor = fetchUsers(itemsCollection, spaceIds);
    const usersArray = await usersCursor.toArray();

    // 'usersArray' is an array of objects, each with a 'memberships' key
    // each 'memberships' key holds an array of objects, each of the format { userId: <mongoId> }
    // i.e. usersArray = [ { memberships: [ { userId: <mongoId> }, ... ] }, ... ]
    logger.debug('reducing retrieved users array to array of unique user ids');
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
    logger.debug("fetching user 'name' and 'provider' info for each user id");
    const usersWithInfo = await fetchUsersWithInfo(
      usersCollection,
      userIds,
    ).toArray();

    // rename user "provider" key to "type" and change its value to be either 'light' or 'graasp'
    logger.debug(
      "converting user 'provider' key to be 'type' and setting it to 'light' or 'graasp'",
    );
    // eslint-disable-next-line arrow-body-style
    let users = usersWithInfo.map(({ provider, ...user }) => {
      return {
        ...user,
        type: provider.startsWith(LOCAL_CONTEXTUAL_STRING)
          ? LIGHT_USER_STRING
          : GRAASP_USER_STRING,
      };
    });

    if (view === COMPOSE_VIEW_STRING) {
      users = users.filter((user) => user.type === GRAASP_USER_STRING);
    }

    logger.debug('structuring results object to be returned as response');
    // structure results object to be returned
    const results = {
      spaceTree,
      actions,
      users,
      metadata: {
        numSpacesRetrieved: spaceTree.length,
        maxTreeLength: MAX_TREE_LENGTH,
        maxTreeLengthExceeded: spaceTree.length >= MAX_TREE_LENGTH,
        requestedSampleSize,
        numActionsRetrieved: actions.length,
      },
    };

    // if view not compose, fetch app instances, and append 'settings' key to each app inst. object
    if (view !== COMPOSE_VIEW_STRING) {
      logger.debug('fetching space appInstances');
      const appInstancesCursor = await fetchAppInstances(
        itemsCollection,
        spaceId,
      );
      const appInstancesArray = await appInstancesCursor.toArray();
      logger.debug('retrieving settings information for each appInstance');
      const appInstances = [];
      for (let i = 0; i < appInstancesArray.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const appInstanceWithSettings = await appendAppInstanceSettings(
          appInstancesCollection,
          appInstancesArray[i],
        );
        appInstances.push(appInstanceWithSettings);
      }
      results.appInstances = appInstances;
    }

    return res.json(results);
  } catch (error) {
    logger.error(error);
    return next(error.message || error);
  }
};

module.exports = { getAnalytics };
