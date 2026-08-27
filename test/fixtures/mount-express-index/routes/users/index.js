// Reached as ./routes/users, resolved through the directory's index file.
const express = require('express');

const usersRouter = express.Router();

usersRouter.get('/users', (req, res) => res.json([]));

module.exports = usersRouter;
