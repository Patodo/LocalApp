export {
  APP_PACKAGE_SCHEMA_VERSION,
  AppPackageValidationError,
  inspectAppPackage,
  writeAppPackage,
  type AppPackageMetadata,
  type InspectedAppPackage,
  type PortablePackageFile,
} from "./lib/app-package.js";

export {
  PLATFORM_CAPABILITIES,
  loadBackendContract,
  validateBackendContract,
  validateMigrationFilenames,
  type BackendManifestConfig,
} from "@localapp/server-core";
