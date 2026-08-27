const express = require('express');

const auditRouter = express.Router();

auditRouter.get('/audit', (req, res) => res.json([]));

module.exports = auditRouter;
