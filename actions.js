const express = require('express');
const ObjectId = require('mongodb').ObjectId;
const router = express.Router();

router.get('/', async (req, res, next) => {
  const { db } = req.app.locals;
  const collection = db.collection('appactions');

  // requests will be of the form .../actions?spaceId=<spaceId>&spaceId=<spaceId>&...&sampleSize=<INT>
  // extract spaceIds from query parameters, map onto array of Mongo ObjectIds
  let { spaceId: spaceIds = [] } = req.query;
  spaceIds = spaceIds.map((spaceId) => ObjectId(spaceId));

  // extract sampleSize from query parameters
  // note: if count of actions in db < sampleSize, MongoDB will return all actions
  const DEFAULT_SAMPLE_SIZE = 50000;
  const MAX_SAMPLE_SIZE = 100000;
  let { sampleSize = DEFAULT_SAMPLE_SIZE } = req.query;
  sampleSize > MAX_SAMPLE_SIZE
    ? (sampleSize = MAX_SAMPLE_SIZE)
    : (sampleSize = parseInt(sampleSize));

  if (!db) {
    return next('Missing db handler');
  }

  try {
    const resultsCursor = await collection.aggregate([
      {
        $match: {
          space: {
            $in: spaceIds,
          },
        },
      },
      { $project: { data: 0 } },
      { $sample: { size: sampleSize } },
    ]);
    const results = await resultsCursor.toArray();
    res.json(results);
  } catch (error) {
    next(error.message || error);
  }
});

module.exports = router;
