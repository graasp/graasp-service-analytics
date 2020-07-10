const router = require('express').Router();

const analyticsRouter = require('./routers/analytics');
const tasksRouter = require('./routers/tasks');

router.get('/analytics', analyticsRouter);
router.get('/tasks', tasksRouter);

module.exports = router;
