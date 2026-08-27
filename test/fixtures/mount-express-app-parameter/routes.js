// A router handed in by whoever calls this function. The prefix that reaches these
// routes is decided in the caller's file, which nothing here ties back to this one, so
// the prefix is unknown rather than absent and the route below is reported short and
// flagged. Publishing /users/me at full confidence would state a path as settled when
// the segment in front of it was never read.
const express = require('express');

module.exports = (app) => {
  const usersRouter = express.Router();

  usersRouter.get('/me', (req, res) => res.json({}));

  app.use('/users', usersRouter);
};
