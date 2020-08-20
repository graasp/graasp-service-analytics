const { ObjectId } = require('mongodb');

const fetchActions = (collection, spaceIds, { sampleSize } = {}) => {
  const spaceObjectIds = spaceIds.map((spaceId) => ObjectId(spaceId));
  const aggregateQuery = [
    {
      $match: {
        space: {
          $in: spaceObjectIds,
        },
      },
    },
  ];

  if (sampleSize) {
    aggregateQuery.push({ $project: { data: 0 } });
    aggregateQuery.push({ $sample: { size: sampleSize } });
  }

  return collection.aggregate(aggregateQuery);
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

const fetchUsers = (collection, spaceIds) => {
  const spaceObjectIds = spaceIds.map((spaceId) => ObjectId(spaceId));
  const aggregateQuery = [
    {
      $match: {
        joinedSpaces: {
          $in: spaceObjectIds,
        },
      },
    },
    { $project: { _id: 1, name: 1, provider: 1 } },
  ];

  return collection.aggregate(aggregateQuery);
};

const fetchApps = async (collection, spaceId) => {
  const { path } = await collection.findOne({ _id: ObjectId(spaceId) });
  collection.createIndex({ category: 1, appInstance: 1, path: 1 });
  const aggregateQuery = [
    {
      $match: {
        category: 'Application',
        appInstance: { $exists: true },
        path: new RegExp(`^${path}`),
      },
    },
    {
      $project: {
        _id: 0,
        url: 1,
        name: 1,
        appInstance: 1,
      },
    },
  ];

  return collection.aggregate(aggregateQuery);
};

const appendAppInstanceSettings = async (collection, appObject) => {
  const { appInstance } = appObject;
  const { settings } = await collection.findOne({ _id: ObjectId(appInstance) });
  return { ...appObject, _id: appInstance, settings };
};

module.exports = {
  fetchActions,
  fetchWholeTree,
  fetchUsers,
  fetchApps,
  appendAppInstanceSettings,
};
