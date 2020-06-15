const express = require('express');
const ObjectId = require('mongodb').ObjectId;
const router = express.Router();

async function fetchWholeTree(collection, ids, parentId = null, results = []) {
  const items = await collection
    .find(
      { _id: { $in: ids }, category: 'Space' },
      { category: 1, subitems: 1 },
    )
    .toArray();

  for (let i = 0; i < items.length; i++) {
    const { _id: id, category, subitems = [] } = items[i];
    results.push({ id, category, parentId });
    console.log('results', results);
    if (subitems.length) {
      await fetchWholeTree(collection, subitems, id, results);
    }
  }
  return results;
}

router.get('/:spaceId', async (req, res, next) => {
  const { spaceId } = req.params;
  const { db } = req.app.locals;
  if (!db) {
    return next('Missing db handler');
  }
  const collection = db.collection('items');
  try {
    const results = await fetchWholeTree(collection, [ObjectId(spaceId)]);
    res.json(results);
  } catch (error) {
    next(error.message || error);
  }
});

module.exports = router;
