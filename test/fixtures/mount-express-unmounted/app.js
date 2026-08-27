// Pins the unmounted case: this app declares a route and mounts nothing, so the
// router in routes/orphan.js is never reached by a prefix.
const express = require('express');

const app = express();

app.get('/health', (req, res) => res.json({ ok: true }));
