// Two mounts above this file. v1.js mounts this router at /users and app.js
// mounts v1 at /api, so these routes really answer under /api/users.
const express = require('express');

const usersRouter = express.Router();

usersRouter.get('/profile', (req, res) => res.json({}));

usersRouter.post('/invite', (req, res) => res.status(201).json({}));

module.exports = usersRouter;
