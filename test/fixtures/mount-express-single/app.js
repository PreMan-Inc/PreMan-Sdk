// Pins a single-level cross-file mount: the imported router picks up /api/v1,
// while this file's own route keeps the path it was written with.
const express = require('express');

const usersRouter = require('./routes/users');

const app = express();

app.use('/api/v1', usersRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
