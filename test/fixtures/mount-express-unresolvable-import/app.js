// Pins a mount whose router is imported from a path that is not in this tree.
// The mount is reported as unresolved; the local route is unaffected.
const express = require('express');

const ghostRouter = require('./routes/ghost');

const app = express();

app.use('/ghost', ghostRouter);

app.get('/health', (req, res) => res.json({ ok: true }));
