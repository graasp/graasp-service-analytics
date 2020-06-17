const ObjectId = require('mongodb').ObjectId;

const fetchWholeTree = async (
  collection,
  ids,
  parentId = null,
  spaceTree = [],
) => {
  const MAX_TREE_LENGTH = 200;
  let numSpacesRetrieved,
    maxTreeLengthExceeded = false;

  const items = await collection
    .find({ _id: { $in: ids }, category: 'Space' }, { subitems: 1, name: 1 })
    .toArray();

  for (let i = 0; i < items.length; i++) {
    const { _id: id, name, subitems = [] } = items[i];
    if (spaceTree.length >= MAX_TREE_LENGTH) {
      maxTreeLengthExceeded = true;
      break;
    }
    spaceTree.push({ id, name, parentId });
    if (subitems.length) {
      await fetchWholeTree(collection, subitems, id, spaceTree);
    }
  }
  numSpacesRetrieved = spaceTree.length;
  return {
    spaceTree,
    numSpacesRetrieved,
    MAX_TREE_LENGTH,
    maxTreeLengthExceeded,
  };
};

const fetchActions = async (collection, sampleSize, ...spaceIds) => {
  spaceIds = spaceIds.map((spaceId) => ObjectId(spaceId));
  const actionsCursor = await collection.aggregate([
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
  const actions = await actionsCursor.toArray();
  const numActionsRetrieved = actions.length;
  return { actions, numActionsRetrieved };
};

module.exports = { fetchWholeTree, fetchActions };
