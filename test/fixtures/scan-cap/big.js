// Sorts after `asub/`, and is big enough on its own to blow a byte budget that
// `app.js` fits inside. `asub/` is already queued by the time this file is read,
// so a walk that only breaks its inner loop still reaches `asub/small.js`.
const express = require('express');
const app = express();
app.get('/big', (req, res) => res.end());
module.exports = app;
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
// padding so this file alone exceeds the byte budget used by the cap test.
