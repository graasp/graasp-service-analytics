const { BASE_URL, RESOURCES_PATH } = require('../config/api');

const markTaskComplete = async (collection, taskId, fileId) => {
  await collection.findOneAndUpdate(
    { _id: taskId },
    {
      $set: {
        completed: true,
        location: `${BASE_URL}/${RESOURCES_PATH}/${fileId}`,
        updatedAt: new Date(Date.now()),
      },
    },
  );
};

module.exports = { markTaskComplete };
