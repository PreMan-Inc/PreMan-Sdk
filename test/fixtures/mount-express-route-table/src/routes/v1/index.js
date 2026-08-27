// The table-driven mount: the prefixes live in an array of object literals and the
// only .use() call in the file names none of them. Reading the table is the only way
// /auth and /users ever reach the routes; without it every route below reports at the
// path it was written with, which for user.route.js is the bare root.
const express = require('express');

const authRoute = require('./auth.route');
const userRoute = require('./user.route');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

module.exports = router;
