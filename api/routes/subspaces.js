const express = require('express');
const ObjectId = require('mongodb').ObjectId;
const router = express.Router();

router.get('/:id', async (req, res, next) => {
  const collection = req.app.locals.collection;
  const spaceId = req.params.id;
  // initialize subspaces (array of objs) with 'main' space ID extracted from route param
  let subspaces = [
    {
      id: spaceId,
      fetchAttempted: false,
      fetchSuccessful: false,
      parentSpaceId: null,
      category: null,
    },
  ];
  // first try-catch block to query DB for 'main' space ID
  try {
    const dbResponse = await collection.findOne({
      _id: ObjectId(spaceId),
    });
    // while some subspace is unfetched, query DB for it
    while (subspaces.some((subspace) => !subspace.fetchAttempted)) {
      for (let subspace of subspaces) {
        if (!subspace.fetchAttempted) {
          try {
            const dbResponse = await collection.findOne({
              _id: ObjectId(subspace.id),
            });
            const { subitems, category } = dbResponse;
            subspace.fetchAttempted = true;
            subspace.fetchSuccessful = true;
            subspace.category = category;
            let mappedSubspaces = [];
            if (!subitems) {
              mappedSubspaces = [];
            } else {
              mappedSubspaces = subitems.map((subitem) => {
                return {
                  id: subitem.toString(),
                  fetchAttempted: false,
                  fetchSuccessful: false,
                  parentSpaceId: subspace.id,
                  category: null,
                };
              });
            }
            subspaces = [...subspaces, ...mappedSubspaces];
          } catch (error) {
            subspace.fetchAttempted = true;
            subspace.fetchSuccessful = false;
          }
        }
      }
    }
  } catch (error) {
    next();
    return;
  }
  res
    .status(200)
    .json(subspaces.filter((subspace) => subspace.category === 'Space'));
  next();
});

module.exports = router;
