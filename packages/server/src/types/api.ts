import type { DataSchema, SchemaField, User } from "./models.js";

/** 文件上传项 */
export interface UploadFile {
  filename: string;
  content: string;
}

/** 页面上传请求 */
export interface UploadRequest {
  userId: string;
  name?: string;
  files: UploadFile[];
}

/** 可移植应用包安装结果 */
export interface AppInstallResponse {
  name: string;
  ownerId: string;
  localVersion: number;
  appVersion: string;
  digest: string;
  created: boolean;
  upgraded: boolean;
  idempotent: boolean;
}

/** Server 保留的应用部署版本 */
export interface AppVersionInfo {
  version: number;
  appVersion: string;
  digest: string;
  createdAt: string;
  fileCount: number;
  totalSize: number;
}

/** 页面信息响应 */
export interface PageInfoResponse {
  name: string;
  userId: string;
  createdAt: string;
  updatedAt: string;
  currentVersion: number;
  currentAppVersion?: string;
  versionCount: number;
  schemas: DataSchema[];
}

/** Schema 创建请求 */
export interface SchemaCreateRequest {
  userId: string;
  pageName: string;
  name: string;
  fields: Record<string, SchemaField>;
}

/** 页面列表项 */
export interface PageListItem {
  name: string;
  currentVersion: number;
  currentAppVersion?: string;
  createdAt: string;
  updatedAt: string;
}

/** 通用 API 响应 */
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/** CLI 版本信息 */
export interface CliVersionEntry {
  released: string;
}

/** CLI 版本清单响应 */
export interface CliVersionResponse {
  min: string;
  latest: string;
  versions: Record<string, CliVersionEntry>;
}

/** CLI 下载请求参数 */
export interface CliDownloadQuery {
  os: string;
  arch: string;
  version?: string;
}

/** 注册请求 */
export interface RegisterRequest {
  username: string;
  password: string;
}

/** 登录请求 */
export interface LoginRequest {
  username: string;
  password: string;
}

/** 认证响应（注册/登录共用） */
export interface AuthResponse {
  id: string;
  name: string;
}

/** /api/me 响应数据 */
export type MeResponse = User | null;
