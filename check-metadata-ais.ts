import admin from 'firebase-admin';

async function checkMetadata() {
  try {
    admin.initializeApp();
    const bucketName = "ais-dev-cpbbnn66o6yfzp5gvn6yon.appspot.com";
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
