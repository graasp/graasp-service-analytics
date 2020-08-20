const { ObjectId } = require('mongodb');
const {
  fetchWholeTree,
  fetchActions,
  fetchUsers,
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
