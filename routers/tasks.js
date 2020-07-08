const router = require('express').Router();
const getTask = require('../controllers/tasks');

router.get('/', getTask);

module.exports = router;
