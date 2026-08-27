const express = require('express');

const invoicesRouter = express.Router();

invoicesRouter.get('/open', (req, res) => res.json([]));

module.exports = invoicesRouter;
