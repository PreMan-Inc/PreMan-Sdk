// A barrel: it declares no router and names express nowhere, and is still the link a
// mount in a third file has to travel to reach the routes. Dropping what it re-exports
// strands the mount, and /users is then reported without the prefix it was mounted at.
//
// The require is bound before it is exported. Written as the one statement
// `module.exports = require('./users')` this barrel is not followed at all — see the
// note in the test that pins this tree.
const users = require('./users');

module.exports = users;
