// The application. Only the two endpoints below may be reported: everything the two
// test files mount describes a throwaway app, not the deployed server.
const express = require('express');

const usersRouter = require('./routes/users');

const app = express();

app.use('/api', usersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));

module.exports = app;
