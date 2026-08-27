const express = require('express');

const reportsRouter = express.Router();

reportsRouter.get('/reports', (req, res) => res.json([]));

module.exports = reportsRouter;
