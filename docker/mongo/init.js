// MongoDB init script — runs once on first container start
// Creates the dialer database user with restricted permissions

db = db.getSiblingDB('dialer');

db.createUser({
  user: process.env.MONGO_USER || 'dialer',
  pwd: process.env.MONGO_PASS || 'changeme',
  roles: [{ role: 'readWrite', db: 'dialer' }],
});

// Seed indexes for performance
db.call_logs.createIndex({ campaignId: 1, startTime: -1 });
db.call_logs.createIndex({ startTime: -1 });
db.contacts.createIndex({ campaignId: 1, dialStatus: 1 });
db.campaigns.createIndex({ status: 1 });

print('DialerOS MongoDB init complete ✅');
