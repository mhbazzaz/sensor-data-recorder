const mqtt = require('mqtt');

console.log('Testing MQTT connection...');
console.log('Broker: mqtt://localhost:1883');
console.log('');

const client = mqtt.connect('mqtt://localhost:1883', {
  clientId: 'test-connection',
  connectTimeout: 5000,
  reconnectPeriod: 0,
});

client.on('connect', () => {
  console.log('✅ SUCCESS: Connected to MQTT broker!');
  client.end();
  process.exit(0);
});

client.on('error', (err) => {
  console.log('❌ FAILED: Cannot connect to MQTT broker!');
  console.log('Error:', err);
  client.end();
  process.exit(1);
});

client.on('close', () => {
  console.log('Connection closed');
});
