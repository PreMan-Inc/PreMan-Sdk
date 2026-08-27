// Two routers declared in one file and exported together. A mount naming one of them
// must move that one alone: taking every export in the file fabricates an endpoint
// for each router the mount never touched.
const express = require('express');

const usersRouter = express.Router();

const adminRouter = express.Router();

usersRouter.get('/users', (req, res) => res.json([]));

adminRouter.get('/dashboard', (req, res) => res.json({}));

module.exports = { usersRouter, adminRouter };
