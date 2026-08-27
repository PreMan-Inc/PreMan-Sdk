// Two routers behind one barrel object. The app reads one of them off the module,
// so only that one may pick the prefix up.
const express = require('express');

const usersRouter = express.Router();

const adminRouter = express.Router();

usersRouter.get('/users', (req, res) => res.json([]));

adminRouter.get('/dashboard', (req, res) => res.json({}));

module.exports = { usersRouter, adminRouter };
