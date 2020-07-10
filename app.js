const express = require('express');
const { MongoClient } = require('mongodb');
const morgan = require('morgan');
const analyticsRouter = require('./routers/analytics');
const tasksRouter = require('./routers/tasks');

const app = express();
// todo: extract URL to process.env
MongoClient.connect('mongodb://localhost:27017', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then((client) => {
  // set database and collection
  const db = client.db('graaspeu');

  // share mongodb connection with application
  app.locals.db = db;

  // middleware
  app.use(morgan('dev'));
  app.use(express.json());
  app.use('/analytics', analyticsRouter);
  app.use('/tasks', tasksRouter);

  // error handlers
  app.use((req, res, next) => {
    const error = new Error('Route not found');
    error.status = 404;
    next(error);
  });
  app.use((error, req, res, next) => {
    res.status(error.status || 500);
    res.json({ error: { message: error.message } });
  });

  // listen on port
  const port = process.env.PORT || 80;
  app.listen(port, () => console.log(`listening on port ${port}`));
});
