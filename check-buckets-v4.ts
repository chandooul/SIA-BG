import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

async function checkBuckets() {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    const projectId = serviceAccount.project_id;
    
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: projectId
      });
    }
    
    const storage = admin.storage();
    const testNames = [
      projectId,
      `${projectId}.appspot.com`,
      `${projectId}.firebasestorage.app`,
      `ai-studio-${projectId}`,
      `ai-studio-${projectId}.appspot.com`,
      "ais-us-east1-1f7da320b8ad4f71a",
      "ais-us-east1-1f7da320b8ad4f71a.appspot.com",
      "ais-dev-cpbbnn66o6yfzp5gvn6yon",
      "ais-dev-cpbbnn66o6yfzp5gvn6yon.appspot.com"
    ];
    
    console.log(`Testing buckets for Project: ${projectId}`);
    for (const name of testNames) {
      const bucket = storage.bucket(name);
      try {
        const [exists] = await bucket.exists();
        console.log(`- ${name}: ${exists ? "EXISTS" : "NOT FOUND"}`);
      } catch (err) {
        console.log(`- ${name}: ERROR (${err.message})`);
      }
    }
  } catch (e) {
    console.error("Error:", e);
  }
}

checkBuckets();
