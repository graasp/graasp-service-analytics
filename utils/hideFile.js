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

  await axios.put(url, requestBody, requestConfig);
};

module.exports = hideFile;
