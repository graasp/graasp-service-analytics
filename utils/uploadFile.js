const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const uploadFile = async (url, cookie, filePath) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const requestConfig = {
    headers: {
      Cookie: cookie,
      ...formData.getHeaders(),
    },
  };

  const response = await axios.post(url, formData, requestConfig);
  return response.data;
};

module.exports = uploadFile;
