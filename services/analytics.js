const { ObjectId } = require('mongodb');

const fetchActions = async (collection, spaceIds, { sampleSize } = {}) => {
  const spaceObjectIds = spaceIds.map((spaceId) => ObjectId(spaceId));
  const aggregateQuery = [
    {
      $match: {
        space: {
          $in: spaceObjectIds,
        },
      },
    },
    { $project: { data: 0 } },
  ];

  if (sampleSize) {
    aggregateQuery.push({ $sample: { size: sampleSize } });
  }

  const aggregationResponse = await collection.aggregate(aggregateQuery);
  return aggregationResponse;
};

const fetchWholeTree = async (
  collection,
  ids,
  { parentId = null, spaceTree = [], MAX_TREE_LENGTH } = {},
) => {
  const items = await collection
    .find({ _id: { $in: ids }, category: 'Space' }, { subitems: 1, name: 1 })
    .toArray();

  for (let i = 0; i < items.length; i += 1) {
    const { _id: id, name, subitems = [] } = items[i];
    if (MAX_TREE_LENGTH && spaceTree.length >= MAX_TREE_LENGTH) break;

    spaceTree.push({ id, name, parentId });

    if (subitems.length) {
      // eslint-disable-next-line no-await-in-loop
      await fetchWholeTree(collection, subitems, {
        parentId: id,
        spaceTree,
        MAX_TREE_LENGTH,
      });
    }
  }

  return spaceTree;
};

module.exports = { fetchActions, fetchWholeTree };
