// FlixParty - 1-Click Server & Public Tunnel Launcher
// Runs both the Signaling Server and Localtunnel in a single terminal window!

const { spawn } = require('child_process');
const path = require('path');

console.log('=====================================================');
console.log('🎬 Starting FlixParty Signaling Server on Port 3000...');
console.log('=====================================================');

// 1. Start Signaling Server
require('./server.js');

// 2. Start Tunnel automatically
setTimeout(() => {
  console.log('\n🌐 Creating public internet tunnel for friends...');
  
  const tunnel = spawn('npx', ['localtunnel', '--port', '3000'], {
    shell: true,
    stdio: ['inherit', 'pipe', 'pipe']
  });

  tunnel.stdout.on('data', (data) => {
    const text = data.toString();
    console.log(text);
    if (text.includes('your url is:')) {
      const match = text.match(/https:\/\/[^\s]+/);
      if (match) {
        const httpUrl = match[0];
        const wssUrl = httpUrl.replace('https://', 'wss://');
        console.log('-----------------------------------------------------');
        console.log('🎉 SUCCESS! Public Tunnel is Ready!');
        console.log(`📌 Public URL for FlixParty Settings:`);
        console.log(`👉  ${wssUrl}`);
        console.log('-----------------------------------------------------');
        console.log(`⚠️ Note: If prompted for password when visiting the link,`);
        console.log(`run: curl https://loca.lt/mytunnelpassword`);
        console.log('-----------------------------------------------------\n');
      }
    }
  });

  tunnel.stderr.on('data', (data) => {
    const text = data.toString();
    if (!text.includes('deprecated')) {
      console.error(text);
    }
  });

  tunnel.on('close', (code) => {
    console.log(`Tunnel closed with code ${code}`);
  });
}, 800);

