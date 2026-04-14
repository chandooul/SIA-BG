import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

async function checkBuckets() {
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: config.projectId
      });
    }
    
    const storage = admin.storage();
    const appletId = "b6ea6f13-4814-4860-b01e-8fdbf28f2cb0";
    const testBuckets = [
      config.storageBucket,
      `ai-studio-${appletId}.appspot.com`,
      `ai-studio-${appletId}`,
      `${config.projectId}.appspot.com`,
      `${config.projectId}.firebasestorage.app`,
      "ais-us-east1-1f7da320b8ad4f71a.appspot.com"
    ];
    
    console.log("Testing specific buckets with Service Account:");
    for (const name of testBuckets) {
      if (!name) continue;
      const bucket = storage.bucket(name);
      try {
        const [exists] = await bucket.exists();
        console.log(`- ${name}: ${exists ? "EXISTS" : "NOT FOUND"}`);
        if (exists) {
            // Try a small upload to be sure
            console.log(`  Attempting test upload to ${name}...`);
            await bucket.file('test-connection.txt').save('test', {
                metadata: { contentType: 'text/plain' }
            });
            console.log(`  UPLOAD SUCCESSFUL to ${name}`);
        }
      } catch (err) {
        console.log(`- ${name}: ERROR (${err.message})`);
      }
    }
  } catch (e) {
    console.error("Error checking buckets:", e);
  }
}

checkBuckets();
