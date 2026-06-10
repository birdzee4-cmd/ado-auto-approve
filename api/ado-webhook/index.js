// api/ado-webhook/index.js
// Expose the same webhook logic as webhook/index.js under the route 'ado-webhook'
const webhookHandler = require('../webhook/index.js');
module.exports = webhookHandler;
