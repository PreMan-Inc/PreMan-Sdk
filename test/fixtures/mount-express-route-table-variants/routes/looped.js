// The same table walked the other way round. A `for (const entry of routes)` body is
// the same mount as a forEach callback and has to read the same rows.
const express = require('express');

const invoicesRouter = require('./invoices');

const router = express.Router();

const routes = [
  { path: '/invoices', route: invoicesRouter },
];

for (const entry of routes) {
  router.use(entry.path, entry.route);
}

module.exports = router;
