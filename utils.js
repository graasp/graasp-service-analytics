const ObjectId = require('mongodb').ObjectId;

const fetchWholeTree = async (
  collection,
  ids,
  {
    parentId = null,
    spaceTree = [],
    MAX_TREE_LENGTH
  } = {}
) => {
  const items = await collection
    .find({ _id: { $in: ids }, category: 'Space' }, { subitems: 1, name: 1 })
    .toArray();

  for (let i = 0; i < items.length; i++) {
    const { _id: id, name, subitems = [] } = items[i];
    if (MAX_TREE_LENGTH && spaceTree.length >= MAX_TREE_LENGTH) break;

    spaceTree.push({ id, name, parentId });

    if (subitems.length) {
      await fetchWholeTree(collection, subitems, { parentId: id, spaceTree, MAX_TREE_LENGTH });
    }
  }

  return spaceTree;
};

const fetchActions = async (collection, sampleSize, ...spaceIds) => {
  const spaceObjectIds = spaceIds.map((spaceId) => ObjectId(spaceId));

  return await collection
    .aggregate([
      {
        $match: {
          space: {
            $in: spaceObjectIds,
          },
        },
      },
      { $project: { data: 0 } },
      { $sample: { size: sampleSize } },
    ])
    .toArray();
};

module.exports = { fetchWholeTree, fetchActions };
