import type { DocKind, ParsedDocument } from "@/lib/documents";
import { supabase } from "@/lib/supabase";

const BUCKET = "medical-projects";

export interface SavedDocumentProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  document: ParsedDocument;
  translations: Record<string, string>;
  edited: Record<string, boolean>;
  sourceLanguage: string;
  targetLanguage: string;
  storagePath?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  file_name: string;
  file_kind: DocKind;
  storage_path: string;
  document_metadata: Omit<ParsedDocument, "bytes">;
  translations: Record<string, string>;
  edited: Record<string, boolean>;
  source_language: string;
  target_language: string;
  created_at: string;
  updated_at: string;
}

function mimeFor(kind: DocKind): string {
  if (kind === "pdf") return "application/pdf";
  if (kind === "docx") return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
}

function withoutBytes(document: ParsedDocument): Omit<ParsedDocument, "bytes"> {
  return {
    kind: document.kind,
    fileName: document.fileName,
    segments: document.segments,
    pageCount: document.pageCount,
    warnings: document.warnings,
    ...(document.blocks ? { blocks: document.blocks } : {}),
  };
}

function fromRow(row: ProjectRow, bytes = new ArrayBuffer(0)): SavedDocumentProject {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    document: { ...row.document_metadata, bytes },
    translations: row.translations ?? {},
    edited: row.edited ?? {},
    sourceLanguage: row.source_language,
    targetLanguage: row.target_language,
    storagePath: row.storage_path,
  };
}

async function currentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw error ?? new Error("Inicia sesión para acceder al historial.");
  return data.user.id;
}

export async function listDocumentProjects(): Promise<SavedDocumentProject[]> {
  await currentUserId();
  const { data, error } = await supabase
    .from("medical_projects")
    .select("id,name,file_name,file_kind,storage_path,document_metadata,translations,edited,source_language,target_language,created_at,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as ProjectRow[]).map((row) => fromRow(row));
}

export async function loadDocumentProject(project: SavedDocumentProject): Promise<SavedDocumentProject> {
  await currentUserId();
  if (!project.storagePath) throw new Error("El proyecto no tiene un documento asociado.");
  const { data, error } = await supabase.storage.from(BUCKET).download(project.storagePath);
  if (error) throw error;
  return { ...project, document: { ...project.document, bytes: await data.arrayBuffer() } };
}

export async function saveDocumentProject(project: SavedDocumentProject): Promise<void> {
  const userId = await currentUserId();
  const extension = project.document.kind;
  const storagePath = `${userId}/${project.id}/original.${extension}`;

  const { data: existing, error: lookupError } = await supabase
    .from("medical_projects")
    .select("id")
    .eq("id", project.id)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (!existing && project.document.bytes.byteLength > 0) {
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, project.document.bytes, { contentType: mimeFor(project.document.kind), upsert: false });
    if (uploadError) throw uploadError;
  }

  const { error } = await supabase.from("medical_projects").upsert({
    id: project.id,
    user_id: userId,
    name: project.name,
    file_name: project.document.fileName,
    file_kind: project.document.kind,
    storage_path: storagePath,
    document_metadata: withoutBytes(project.document),
    translations: project.translations,
    edited: project.edited,
    source_language: project.sourceLanguage,
    target_language: project.targetLanguage,
    created_at: new Date(project.createdAt).toISOString(),
    updated_at: new Date(project.updatedAt).toISOString(),
  });
  if (error) throw error;
}

export async function deleteDocumentProject(id: string): Promise<void> {
  const userId = await currentUserId();
  const { data: files, error: listError } = await supabase.storage.from(BUCKET).list(`${userId}/${id}`);
  if (listError) throw listError;
  if (files && files.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(files.map((file) => `${userId}/${id}/${file.name}`));
    if (removeError) throw removeError;
  }
  const { error } = await supabase.from("medical_projects").delete().eq("id", id);
  if (error) throw error;
}
