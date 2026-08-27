// The middle link: mounts a router and is itself mounted, so the prefix chain
// has to be walked two levels rather than one.
const express = require('express');

const usersRouter = require('./routes/users');

const v1 = express.Router();

v1.use('/users', usersRouter);

module.exports = v1;
