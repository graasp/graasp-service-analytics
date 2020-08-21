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

const fetchUsers = async (collection, spaceIds) => {
  const users = [];
  for (let i = 0; i < spaceIds.length; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const { memberships } = await collection.findOne(
      { _id: ObjectId(spaceIds[i]) },
      { projection: { _id: 0, memberships: 1 } },
    );
    if (memberships) {
      memberships.forEach(({ userId }) => users.push(userId.toString()));
    }
  }
  // return only unique users
  return [...new Set(users)];
};

const appendUserInfo = async (collection, userId) => {
  const { name, provider } = await collection.findOne({
    _id: ObjectId(userId),
  });
  return { _id: userId, name, type: provider };
};

const fetchAppInstances = async (collection, spaceId) => {
  const { path } = await collection.findOne({ _id: ObjectId(spaceId) });
  collection.createIndex({ category: 1, appInstance: 1, path: 1 });
  return collection.find(
    {
      category: 'Application',
      appInstance: { $exists: true },
      path: new RegExp(`^${path}`),
    },
    {
      projection: {
        _id: 0,
        url: 1,
        name: 1,
        appInstance: 1,
      },
    },
  );
};

const appendAppInstanceSettings = async (collection, appInstanceObject) => {
  const { appInstance, url, name } = appInstanceObject;
  const { settings } = await collection.findOne({ _id: ObjectId(appInstance) });
  return {
    _id: appInstance,
    url,
    name,
    settings,
  };
};

module.exports = {
  fetchActions,
  fetchWholeTree,
  fetchUsers,
  appendUserInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
};
