const express = require('express');

const router = express.Router();

router.get('/settings', (req, res) => res.json({}));

module.exports = router;
