// A .route() chain followed by unrelated code. The chain must stop at the end
// of its own expression, not run on into the next statement.
const express = require('express');

const router = express.Router();
const cache = new Map();

router.route('/chain').get(a).post(b);

const stale = cache.get('leaked');
