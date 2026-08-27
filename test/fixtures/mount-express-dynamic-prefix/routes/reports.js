// Mounted under a prefix the scanner cannot read, so these routes are reported
// exactly as written, with confidence lowered rather than a guessed prefix.
const express = require('express');

const reportsRouter = express.Router();

reportsRouter.get('/reports', (req, res) => res.json([]));

module.exports = reportsRouter;
