import admin from 'firebase-admin';

async function checkMetadata() {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id
    });
    
    const bucketName = "my-project-1571939616356.appspot.com";
    const bucket = admin.storage().bucket(bucketName);
    console.log(`Checking metadata for: ${bucketName}`);
    const [metadata] = await bucket.getMetadata();
    console.log("Metadata found!");
  } catch (e) {
    console.error("Error:", e.message);
    if (e.code) console.error("Error code:", e.code);
  }
}

checkMetadata();
