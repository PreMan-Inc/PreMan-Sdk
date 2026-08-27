// Pins index resolution: the specifier names a directory, and the router lives
// in routes/users/index.js.
const express = require('express');

const usersRouter = require('./routes/users');

const app = express();

app.use('/api', usersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
