// Plain helpers. No express import, so this file declares no routes even
// though the line below looks like one.
// Decoy: app.get('/not-a-route', handler)

function formatUser(id) {
  return { id: String(id) };
}

function titleCase(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

module.exports = { formatUser, titleCase };
