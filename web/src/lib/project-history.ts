import type { ParsedDocument } from "@/lib/documents";

const DB_NAME = "medlingua-local-history";
const DB_VERSION = 1;
const DOCUMENTS = "documents";
const STATES = "states";

interface DocumentRecord {
  id: string;
  document: ParsedDocument;
  createdAt: number;
  sourceLanguage: string;
  targetLanguage: string;
}

interface StateRecord {
  id: string;
  translations: Record<string, string>;
  edited: Record<string, boolean>;
  updatedAt: number;
}

export interface StoredProject extends DocumentRecord, StateRecord {}

export interface ProjectSummary {
  id: string;
  fileName: string;
  kind: ParsedDocument["kind"];
  createdAt: number;
  updatedAt: number;
  sourceLanguage: string;
  targetLanguage: string;
  translatedCount: number;
  totalSegments: number;
  size: number;
}

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("No se pudo acceder al historial local."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar el proyecto."));
    transaction.onabort = () => reject(transaction.error ?? new Error("El guardado local fue cancelado."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains(DOCUMENTS)) database.createObjectStore(DOCUMENTS, { keyPath: "id" });
      if (!database.objectStoreNames.contains(STATES)) database.createObjectStore(STATES, { keyPath: "id" });
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("El navegador no permitió abrir el historial local."));
  });
}

export function newProjectId(): string {
  return `${Date.now()}-${crypto.randomUUID()}`;
}

export async function createLocalProject(input: {
  id: string;
  document: ParsedDocument;
  sourceLanguage: string;
  targetLanguage: string;
  translations?: Record<string, string>;
  edited?: Record<string, boolean>;
}): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction([DOCUMENTS, STATES], "readwrite");
  const { translations = {}, edited = {}, ...documentInput } = input;
  tx.objectStore(DOCUMENTS).put({ ...documentInput, createdAt: Date.now() } satisfies DocumentRecord);
  tx.objectStore(STATES).put({ id: input.id, translations, edited, updatedAt: Date.now() } satisfies StateRecord);
  await transactionDone(tx);
  database.close();
}

export async function saveLocalProjectState(
  id: string,
  translations: Record<string, string>,
  edited: Record<string, boolean>,
): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(STATES, "readwrite");
  tx.objectStore(STATES).put({ id, translations, edited, updatedAt: Date.now() } satisfies StateRecord);
  await transactionDone(tx);
  database.close();
}

export async function saveLocalProjectLanguages(
  id: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction(DOCUMENTS, "readwrite");
  const store = tx.objectStore(DOCUMENTS);
  const record = await request(store.get(id) as IDBRequest<DocumentRecord | undefined>);
  if (record) store.put({ ...record, sourceLanguage, targetLanguage } satisfies DocumentRecord);
  await transactionDone(tx);
  database.close();
}

export async function loadLocalProject(id: string): Promise<StoredProject | undefined> {
  const database = await openDatabase();
  const tx = database.transaction([DOCUMENTS, STATES], "readonly");
  const [doc, state] = await Promise.all([
    request(tx.objectStore(DOCUMENTS).get(id) as IDBRequest<DocumentRecord | undefined>),
    request(tx.objectStore(STATES).get(id) as IDBRequest<StateRecord | undefined>),
  ]);
  database.close();
  if (!doc) return undefined;
  // A project document can survive an interrupted state write. Recover it
  // instead of displaying it in History but refusing to open it.
  const recoveredState: StateRecord = state ?? {
    id,
    translations: {},
    edited: {},
    updatedAt: doc.createdAt,
  };
  return { ...doc, ...recoveredState };
}

export async function listLocalProjects(): Promise<ProjectSummary[]> {
  const database = await openDatabase();
  const tx = database.transaction([DOCUMENTS, STATES], "readonly");
  const [documents, states] = await Promise.all([
    request(tx.objectStore(DOCUMENTS).getAll() as IDBRequest<DocumentRecord[]>),
    request(tx.objectStore(STATES).getAll() as IDBRequest<StateRecord[]>),
  ]);
  database.close();
  const stateById = new Map(states.map((state) => [state.id, state]));
  return documents
    .map((doc) => {
      const state = stateById.get(doc.id);
      return {
        id: doc.id,
        fileName: doc.document.fileName,
        kind: doc.document.kind,
        createdAt: doc.createdAt,
        updatedAt: state?.updatedAt ?? doc.createdAt,
        sourceLanguage: doc.sourceLanguage,
        targetLanguage: doc.targetLanguage,
        translatedCount: doc.document.segments.filter((segment) => state?.translations[segment.id]?.trim()).length,
        totalSegments: doc.document.segments.length,
        size: doc.document.bytes.byteLength,
      };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteLocalProject(id: string): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction([DOCUMENTS, STATES], "readwrite");
  tx.objectStore(DOCUMENTS).delete(id);
  tx.objectStore(STATES).delete(id);
  await transactionDone(tx);
  database.close();
}

export async function clearLocalProjects(): Promise<void> {
  const database = await openDatabase();
  const tx = database.transaction([DOCUMENTS, STATES], "readwrite");
  tx.objectStore(DOCUMENTS).clear();
  tx.objectStore(STATES).clear();
  await transactionDone(tx);
  database.close();
}
