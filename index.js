const router = require('express').Router();

const analyticsRouter = require('./routers/analytics');
const tasksRouter = require('./routers/tasks');

router.use('/analytics', analyticsRouter);
router.use('/tasks', tasksRouter);

module.exports = router;
