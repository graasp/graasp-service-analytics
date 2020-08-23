const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchActions,
  fetchUsers,
  fetchUsersWithInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
} = require('../services/analytics');

const getAnalytics = async (req, res, next) => {
  // extract and set DB/collection parameters
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const itemsCollection = db.collection('items');
  const actionsCollection = db.collection('appactions');
  const usersCollection = db.collection('users');
  const appInstancesCollection = db.collection('appinstances');

  // note: if actual count of actions in db < requestedSampleSize, MongoDB will return all actions
  const DEFAULT_SAMPLE_SIZE = 50000;
  const MAX_SAMPLE_SIZE = 100000;
  const MAX_TREE_LENGTH = 200;

  // extract query params, parse requestedSampleSize
  const { spaceId } = req.query;
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
    const spaceTree = await fetchWholeTree(
      itemsCollection,
      [ObjectId(spaceId)],
      { MAX_TREE_LENGTH },
    );

    // map array of spaceId objects to array of space ids
    const spaceIds = spaceTree.map((space) => space.id);

    // fetch (sample of) actions of retrieved space ids
    const actionsCursor = fetchActions(actionsCollection, spaceIds, {
      sampleSize: requestedSampleSize,
    });
    const actions = await actionsCursor.toArray();

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
      spaceId,
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

    // structure results object to be returned
    const results = {
      spaceTree,
      actions,
      users,
      appInstances,
      metadata: {
        numSpacesRetrieved: spaceTree.length,
        maxTreeLength: MAX_TREE_LENGTH,
        maxTreeLengthExceeded: spaceTree.length >= MAX_TREE_LENGTH,
        requestedSampleSize,
        numActionsRetrieved: actions.length,
      },
    };

    return res.json(results);
  } catch (error) {
    return next(error.message || error);
  }
};

module.exports = { getAnalytics };
