// One row of the table states a path this scan cannot value. The uncertainty is that
// row's alone: the admin routes report short and flagged, while the sibling row keeps
// its literal prefix at full confidence. Failing the whole table over one row would
// throw away a prefix that was written down and readable.
const express = require('express');

const authRoute = require('./auth');
const adminRoute = require('./admin');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: process.env.ADMIN_PATH,
    route: adminRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

module.exports = router;
