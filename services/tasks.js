const markTaskComplete = async (collection, taskId, fileId) => {
  await collection.findOneAndUpdate(
    { _id: taskId },
    {
      $set: {
        completed: true,
        location: `https://graasp.eu/resources/${fileId}`,
      },
    },
  );
};

module.exports = { markTaskComplete };
