import admin from 'firebase-admin';

async function checkBucket() {
  try {
    admin.initializeApp();
    const bucketName = "ais-us-east1-1f7da320b8ad4f71a.appspot.com";
    const bucket = admin.storage().bucket(bucketName);
    console.log(`Checking bucket: ${bucketName}`);
    const [exists] = await bucket.exists();
    console.log(`Exists: ${exists}`);
  } catch (e) {
    console.error("Error:", e.message);
  }
}

checkBucket();
