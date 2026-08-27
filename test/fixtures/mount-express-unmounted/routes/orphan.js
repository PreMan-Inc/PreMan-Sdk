// Nobody mounts this router. Its routes must appear at the paths written here,
// with no prefix invented for them.
const express = require('express');

const orphanRouter = express.Router();

orphanRouter.get('/orphan', (req, res) => res.json([]));

module.exports = orphanRouter;
