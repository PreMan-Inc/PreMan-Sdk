// One router, mounted twice by app.js. Both mounts are real, so this route
// answers on two paths and must be reported twice.
const express = require('express');

const pingRouter = express.Router();

pingRouter.get('/ping', (req, res) => res.json({ ok: true }));

module.exports = pingRouter;
