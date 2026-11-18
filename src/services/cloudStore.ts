import { getApps, initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  deleteUser,
  indexedDBLocalPersistence,
  initializeAuth,
  OAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithCredential,
  signOut,
} from "firebase/auth";
import type { User } from "firebase/auth";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  initializeFirestore,
  writeBatch,
} from "firebase/firestore";
import { firebaseConfig, usesFirebaseEmulator } from "./cloudConfig";

const CHUNK_CHARS = 240_000;
const MAX_CHUNKS = 120;
const BATCH_LIMIT = 450;

export interface CloudUser {
  uid: string;
  name: string;
  email: string;
}

const app = getApps()[0] ?? initializeApp(firebaseConfig as Record<string, string>);
const auth = initializeAuth(app, { persistence: indexedDBLocalPersistence });
const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true });

if (import.meta.env.DEV && usesFirebaseEmulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
}

function toCloudUser(user: User): CloudUser {
  return {
    uid: user.uid,
    name: user.displayName ?? "",
    email: user.email ?? "",
  };
}

function googleCredential(idToken: string, rawNonce: string) {
  return new OAuthProvider("google.com").credential({ idToken, rawNonce });
}

export function watchUser(callback: (user: CloudUser | null) => void) {
  return onAuthStateChanged(auth, (user) =>
    callback(user ? toCloudUser(user) : null),
  );
}

export async function signInWithGoogleToken(idToken: string, rawNonce: string) {
  await signInWithCredential(auth, googleCredential(idToken, rawNonce));
}

export function signOutCloud() {
  return signOut(auth);
}

function metaRef(uid: string) {
  return doc(db, "users", uid, "library", "meta");
}

function chunksRef(uid: string) {
  return collection(db, "users", uid, "chunks");
}

function chunkId(index: number) {
  return String(index).padStart(3, "0");
}

export async function readLibrary(uid: string): Promise<unknown | null> {
  const meta = await getDocFromServer(metaRef(uid));
  if (!meta.exists()) return null;

  const { revision, chunkCount } = meta.data();
  const chunks = await getDocsFromServer(chunksRef(uid));
  const parts = chunks.docs
    .filter((item) => item.data().revision === revision)
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => String(item.data().data ?? ""));

  // Otro dispositivo puede estar guardando: se reintenta en la siguiente pasada.
  if (parts.length !== chunkCount) throw new Error("cloud_busy");
  return JSON.parse(parts.join(""));
}

async function commitInBatches(
  operations: Array<(batch: ReturnType<typeof writeBatch>) => void>,
) {
  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = writeBatch(db);
    operations.slice(index, index + BATCH_LIMIT).forEach((run) => run(batch));
    await batch.commit();
  }
}

export async function writeLibrary(uid: string, json: string) {
  const count = Math.max(1, Math.ceil(json.length / CHUNK_CHARS));
  if (count > MAX_CHUNKS) throw new Error("cloud_too_large");

  const revision = crypto.randomUUID();
  const existing = await getDocsFromServer(chunksRef(uid));
  const operations: Array<(batch: ReturnType<typeof writeBatch>) => void> = [];

  for (let index = 0; index < count; index += 1) {
    const data = json.slice(index * CHUNK_CHARS, (index + 1) * CHUNK_CHARS);
    operations.push((batch) =>
      batch.set(doc(chunksRef(uid), chunkId(index)), { revision, index, data }),
    );
  }
  operations.push((batch) =>
    batch.set(metaRef(uid), {
      version: 1,
      revision,
      chunkCount: count,
      updatedAt: Date.now(),
    }),
  );
  await commitInBatches(operations);

  const stale = existing.docs.filter((item) => Number(item.id) >= count);
  await commitInBatches(
    stale.map((item) => (batch) => batch.delete(item.ref)),
  );
}

async function deleteLibrary(uid: string) {
  const chunks = await getDocsFromServer(chunksRef(uid));
  await commitInBatches([
    (batch) => batch.delete(metaRef(uid)),
    ...chunks.docs.map(
      (item) => (batch: ReturnType<typeof writeBatch>) => batch.delete(item.ref),
    ),
  ]);
}

/** Confirma la identidad, borra los datos y después la cuenta. */
export async function deleteCloudAccount(idToken: string, rawNonce: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("cloud_signed_out");
  await reauthenticateWithCredential(user, googleCredential(idToken, rawNonce));
  await deleteLibrary(user.uid);
  await deleteUser(user);
}
