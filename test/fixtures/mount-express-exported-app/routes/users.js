const express = require('express');

const usersRouter = express.Router();

usersRouter.get('/users', (req, res) => res.json([]));

module.exports = usersRouter;
