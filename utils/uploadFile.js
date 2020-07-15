const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const deleteFileLocally = require('./deleteFileLocally');

const uploadFile = async (url, cookie, filePath) => {
  const formData = new FormData();
  formData.append('file', fs.createReadStream(filePath));

  const requestConfig = {
    headers: {
      Cookie: cookie,
      ...formData.getHeaders(),
    },
  };

  return await axios
    .post(url, formData, requestConfig)
    .then((response) => {
      deleteFileLocally(filePath)
      return response.data._id;
    });
};

module.exports = uploadFile;
