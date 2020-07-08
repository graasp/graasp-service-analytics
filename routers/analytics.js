const router = require('express').Router();
const { getAnalytics, createTask } = require('../controllers/analytics');

router.get('/', getAnalytics);
router.post('/', createTask);

module.exports = router;
