// Pins a non-literal mount prefix: app.use(basePath, router). The route below
// is mounted directly and keeps full confidence.
const express = require('express');

const reportsRouter = require('./routes/reports');

const basePath = process.env.API_BASE;

const app = express();

app.use(basePath, reportsRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
