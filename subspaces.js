const express = require('express');
const ObjectId = require('mongodb').ObjectId;
const { fetchWholeTree, fetchActions } = require('./utils');
const router = express.Router();

router.get('/', async (req, res, next) => {
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

  // extract query params, parse requestedSampleSize
  let { spaceId, requestedSampleSize = DEFAULT_SAMPLE_SIZE } = req.query;
  requestedSampleSize > MAX_SAMPLE_SIZE
    ? (requestedSampleSize = MAX_SAMPLE_SIZE)
    : (requestedSampleSize = parseInt(requestedSampleSize));

  try {
    // fetch space tree
    const {
      spaceTree,
      numSpacesRetrieved,
      MAX_TREE_LENGTH,
      maxTreeLengthExceeded,
    } = await fetchWholeTree(itemsCollection, [ObjectId(spaceId)]);

    // fetch (sample of) actions of retrieved space ids
    const spaceIds = spaceTree.map((space) => space.id);
    const { actions, numActionsRetrieved } = await fetchActions(
      actionsCollection,
      requestedSampleSize,
      ...spaceIds,
    );

    // structure results object to be returned
    const results = {
      spaceTree,
      actions,
      metadata: {
        numSpacesRetrieved,
        maxTreeLength: MAX_TREE_LENGTH,
        maxTreeLengthExceeded,
        requestedSampleSize,
        numActionsRetrieved,
      },
    };

    res.json(results);
  } catch (error) {
    next(error.message || error);
  }
});

module.exports = router;
