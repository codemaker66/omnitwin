declare module "gltf-validator" {
  export interface ValidationOptions {
    readonly uri?: string;
    readonly format?: "glb" | "gltf";
    readonly writeTimestamp?: boolean;
    readonly maxIssues?: number;
    readonly ignoredIssues?: readonly string[];
    readonly onlyIssues?: readonly string[];
    readonly severityOverrides?: Readonly<Record<string, number>>;
    readonly externalResourceFunction?: (uri: string) => Promise<Uint8Array>;
  }

  export function version(): string;
  export function supportedExtensions(): readonly string[];
  export function validateBytes(data: Uint8Array, options?: ValidationOptions): Promise<unknown>;
  export function validateString(json: string, options?: ValidationOptions): Promise<unknown>;
}

