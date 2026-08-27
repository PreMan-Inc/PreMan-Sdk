// The same table under different key names. Both keys are read from the .use() call
// rather than assumed, so `{ prefix, router }` mounts exactly as `{ path, route }` does.
const express = require('express');

const billingRouter = require('./billing');

const router = express.Router();

const routes = [
  { prefix: '/billing', router: billingRouter },
];

routes.forEach((entry) => {
  router.use(entry.prefix, entry.router);
});

module.exports = router;
