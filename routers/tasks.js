const router = require('express').Router();
const { getTask, createTask } = require('../controllers/tasks');

router.get('/', getTask);
router.post('/', createTask);

module.exports = router;
