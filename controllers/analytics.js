const { ObjectId } = require('mongodb');
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

    // fetch (sample of) actions of retrieved space ids
    const spaceIds = spaceTree.map((space) => space.id);
    const actions = await (
      await fetchActions(actionsCollection, spaceIds, {
        sampleSize: requestedSampleSize,
      })
    ).toArray();

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

    return res.json(results);
  } catch (error) {
    return next(error.message || error);
  }
};

module.exports = { getAnalytics };
