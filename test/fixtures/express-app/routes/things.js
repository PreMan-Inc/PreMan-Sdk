// A .route() chain. chainedMethods walks the real expression and stops at the
// `;`, so a later method-shaped call cannot be mistaken for a chained method.
const express = require('express');

const thingsRouter = express.Router();

function listThings(req, res) {
  res.json([]);
}

function createThing(req, res) {
  res.status(201).json({ id: '1' });
}

thingsRouter.route('/things')
  .get(listThings)
  .post(createThing);

module.exports = thingsRouter;
