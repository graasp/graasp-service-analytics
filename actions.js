const express = require('express');
const ObjectId = require('mongodb').ObjectId;
const router = express.Router();

router.get('/', async (req, res, next) => {
  const { db } = req.app.locals;
  const collection = db.collection('appactions');

  // requests will be of the form .../actions?spaceId=<spaceId>&spaceId=<spaceId>&...
  let { spaceId: spaceIds = [] } = req.query;
  spaceIds = spaceIds.map((spaceId) => ObjectId(spaceId));

  // if count of returned actions < SAMPLE_SIZE, all actions will be returned
  const SAMPLE_SIZE = 50000;

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
      { $sample: { size: SAMPLE_SIZE } },
    ]);
    const results = await resultsCursor.toArray();
    res.json(results);
  } catch (error) {
    next(error.message || error);
  }
});

module.exports = router;
