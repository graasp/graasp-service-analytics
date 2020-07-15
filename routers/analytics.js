const router = require('express').Router();
const { getAnalytics } = require('../controllers/analytics');

router.get('/', getAnalytics);

module.exports = router;
