const markTaskComplete = async (collection, taskId, fileId) => {
  await collection.findOneAndUpdate(
    { _id: taskId },
    {
      $set: {
        completed: true,
        location: `https://graasp.eu/resources/${fileId}`,
        updatedAt: new Date(Date.now()),
      },
    },
  );
};

module.exports = { markTaskComplete };
