const express = require('express');

const billingRouter = express.Router();

billingRouter.get('/plans', (req, res) => res.json([]));

module.exports = billingRouter;
