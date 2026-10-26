export function getStorage() { return {}; }
export function ref(s, path) { return { path }; }
export async function uploadBytes() { return {}; }
export async function getBlob() { return new Blob(['fixture'], { type: 'application/pdf' }); }
export async function deleteObject() { return undefined; }
