// A router declared here and mounted elsewhere. The paths written below are not
// the paths the server answers on: app.js mounts this router under /api/v1.
const express = require('express');

const usersRouter = express.Router();

usersRouter.get('/users', (req, res) => res.json([]));

usersRouter.get('/users/:id', (req, res) => res.json({ id: req.params.id }));

module.exports = usersRouter;
