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
  return collection.find(
    { _id: { $in: spaceObjectIds } },
    { projection: { _id: 0, 'memberships.userId': 1 } },
  );
};

const fetchUsersWithInfo = (collection, userIds) => {
  const userObjectIds = userIds.map((userId) => ObjectId(userId));
  return collection.find(
    { _id: { $in: userObjectIds } },
    { projection: { name: 1, provider: 1 } },
  );
};

const fetchAppInstances = async (collection, spaceId) => {
  const { path } = await collection.findOne({ _id: ObjectId(spaceId) });
  collection.createIndex({ category: 1, appInstance: 1, path: 1 });
  return collection.find(
    {
      category: 'Application',
      appInstance: { $exists: true },
      path: new RegExp(`^${path}${spaceId}~`),
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

// eslint-disable-next-line arrow-body-style
const fetchAppInstanceResources = (collection, appInstanceIds) => {
  return collection.find({ appInstance: { $in: appInstanceIds } });
};

module.exports = {
  fetchActions,
  fetchWholeTree,
  fetchUsers,
  fetchUsersWithInfo,
  fetchAppInstances,
  appendAppInstanceSettings,
  fetchAppInstanceResources,
};
