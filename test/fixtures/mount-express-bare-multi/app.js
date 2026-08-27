// Each router is mounted under its own prefix. Exactly two endpoints may result:
// /api/users and /internal/dashboard. /api/dashboard and /internal/users are paths
// the server has nothing at, and both appeared before the mount was narrowed.
const express = require('express');

const { usersRouter, adminRouter } = require('./routes/all');

const app = express();

app.use('/api', usersRouter);

app.use('/internal', adminRouter);
