const axios = require('axios');

const hideFile = async (url, cookie, fileId) => {
  const requestConfig = {
    headers: {
      Cookie: cookie,
    },
  };

  const requestBody = {
    items: [fileId],
    changes: { hidden: true },
  };

  try {
    await axios.put(url, requestBody, requestConfig);
  } catch (err) {
    throw new Error('an error occurred during the file hide operation');
  }
};

module.exports = hideFile;
