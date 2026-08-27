const express = require('express');

const router = express.Router();

router.get('/', (req, res) => res.json([]));

router.get('/:userId', (req, res) => res.json({ id: req.params.userId }));

module.exports = router;
