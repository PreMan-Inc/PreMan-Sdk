// User routes on a Router. Mounted at the root, so no prefix joining applies.
const express = require('express');

const usersRouter = express.Router();

usersRouter.post('/users', (req, res) => {
  res.status(201).json({ id: '1' });
});

usersRouter.patch('/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

module.exports = { usersRouter };
